#!/usr/bin/env python3
import bisect
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tokenize
from collections import namedtuple

USAGE = """usage: comments.sh [--library] [<ref>]
       comments.sh [--library] --all"""

Found = namedtuple("Found", "line end text full doc")

EXTENSIONS = {
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".py": "python",
    ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js", ".tsx": "js",
    ".ts": "ts", ".mts": "ts", ".cts": "ts",
    ".go": "go", ".rs": "rust", ".css": "css", ".html": "html",
}
LICENCE = re.compile(r"copyright|licen[sc]e", re.I)
COMMENT_START = re.compile(r"#|//|/\*|<!--")
OPENER = r"^(?:#|//+|/\*+|<!--)(?:\s|\*)*"
SUPPRESSION_COMMENT = re.compile(
    OPENER
    + r"(?:shellcheck\s+disable="
    r"|noqa\b"
    r"|type:\s*ignore"
    r"|pylint:\s*disable"
    r"|pyright:\s*ignore"
    r"|pragma:\s*no cover"
    r"|nosec\b"
    r"|eslint-disable"
    r"|@ts-ignore"
    r"|@ts-nocheck"
    r"|biome-ignore"
    r"|prettier-ignore"
    r"|(?:istanbul|c8|v8)\s+ignore"
    r"|nolint"
    r"|lint:ignore)"
)
DIRECTIVE = re.compile(
    r"^#[ \t]*(?:shellcheck\b(?!\s+disable=)|(?:-\*-\s*)?coding[:=]|type:\s*(?!ignore)|fmt:)"
    r"|^///[ \t]*<reference"
    r"|^//go:"
    r"|^//[ \t]*\+build"
    r"|^/\*[ \t]*globals?\s"
    r"|"
    + OPENER
    + r"(?:@ts-expect-error|@ts-check|@jsx|[@#]__PURE__|eslint-env|@vitest-environment|@jest-environment)"
)
JS_SKIP = re.compile(r"\.skip\(|\bx(?:it|describe|test)\(")
CODE_SUPPRESSION = {
    "js": JS_SKIP,
    "ts": JS_SKIP,
    "html": JS_SKIP,
    "python": re.compile(r"@pytest\.mark\.skip\b|@pytest\.mark\.xfail|@unittest\.skip\("),
    "rust": re.compile(r"#!?\[(?:ignore|allow\()"),
}
JS_KEYWORDS_BEFORE_REGEX = frozenset(
    "return typeof case do else in of instanceof new delete void throw yield await".split()
)
JS_WORD = re.compile(r"(?:[^\W\d]|\$)[\w$]*")
JSX_OPEN = re.compile(r"<(?:>|[A-Za-z_$][\w$.:-]*(?=[\s/>]))")
JS_NUMBER = re.compile(r"\d[\w.]*")
RUST_RAW = re.compile(r'b?r(#*)"')
RUST_WORD = re.compile(r"\w+")
GO_DECLARATION = re.compile(r"package\b|func\s+(?:\([^)]*\)\s*)?[A-Z]|(?:type|var|const)\s+[A-Z]")
HEREDOC = re.compile(r"<<(-?)[ \t]*(?:'([^'\n]*)'|\"([^\"\n]*)\"|\\?([^\s;|&<>()'\"\\]+))")
PYTHON_WORD = re.compile(r"(?:^|[\s/;|&(])python3?(?=\s|$)")
HTML_TOKEN = re.compile(r"<!--|<(script|style)\b([^>]*)>", re.I)
HTML_SCRIPT_TYPE = re.compile(r"""type\s*=\s*["']?([^"'\s>]+)""", re.I)
HUNK = re.compile(r"^@@ -\S+ \+(\d+)(?:,(\d+))? @@", re.M)
FSTRING_START = getattr(tokenize, "FSTRING_START", -1)
FSTRING_END = getattr(tokenize, "FSTRING_END", -1)


class Unreadable(Exception):
    pass


READ_ERRORS = (Unreadable, tokenize.TokenError, SyntaxError, UnicodeDecodeError)


def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def run(args, check=True):
    p = subprocess.run(args, capture_output=True, text=True, errors="replace")
    if check and p.returncode != 0:
        die(f"{' '.join(args[:4])}: {p.stderr.strip()}", 2)
    return p


class Lines:
    def __init__(self, text):
        self.starts = [0] + [m.end() for m in re.finditer("\n", text)]

    def at(self, index):
        return bisect.bisect_right(self.starts, index)

    def index(self, row, col, limit):
        return min(self.starts[min(row, len(self.starts)) - 1] + col, limit)


def blank_out(chars, start, end):
    for k in range(start, end):
        if chars[k] != "\n":
            chars[k] = " "


def record(found, src, text, start, end, doc):
    full = text[start:end]
    found.append(Found(src.at(start), src.at(max(start, end - 1)), full.split("\n", 1)[0].rstrip(), full, doc))


def line_end(text, i):
    end = text.find("\n", i)
    return len(text) if end < 0 else end


def skip_quoted(text, i, multiline=False):
    quote = text[i]
    j = i + 1
    while j < len(text):
        c = text[j]
        if c == "\\":
            j += 2
        elif c == quote:
            return j + 1
        elif c == "\n" and not multiline:
            return j
        else:
            j += 1
    return len(text)


def block_end(text, i, nested):
    depth = 1
    j = i + 2
    while j < len(text):
        if nested and text.startswith("/*", j):
            depth += 1
            j += 2
        elif text.startswith("*/", j):
            depth -= 1
            j += 2
            if depth == 0:
                return j
        else:
            j += 1
    raise Unreadable("unterminated block comment")


def template_chunk(text, chars, start):
    i = start + 1
    while i < len(text):
        c = text[i]
        if c == "\\":
            i += 2
        elif c == "`":
            blank_out(chars, start, i + 1)
            return i + 1, False
        elif text.startswith("${", i):
            blank_out(chars, start, i + 2)
            return i + 2, True
        else:
            i += 1
    raise Unreadable("unterminated template literal")


def jsx_opens(text, i):
    m = JSX_OPEN.match(text, i)
    if not m:
        return False
    name = m.group(0)[1:]
    if re.compile("</" + re.escape(name) + r"\s*>").search(text, m.end()):
        return True
    depth = 0
    j = m.end()
    while j < len(text):
        c = text[j]
        if c in "'\"":
            j = skip_quoted(text, j, True)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        elif c == ">" and depth == 0:
            return text[j - 1] == "/"
        j += 1
    return False


def scan_js(text, jsx=False):
    src = Lines(text)
    chars = list(text)
    found = []
    stack = []
    n = len(text)
    i = 0
    regex_ok = True
    if text.startswith("#!"):
        i = line_end(text, 0)
        blank_out(chars, 0, i)
    while i < n:
        c = text[i]
        two = text[i:i + 2]
        kind = stack[-1][0] if stack else "js"
        if kind == "text":
            if two == "</":
                end = text.find(">", i)
                if end < 0:
                    raise Unreadable("unterminated JSX")
                stack.pop()
                i = end + 1
                regex_ok = False
            elif c == "<" and jsx_opens(text, i):
                stack.append(["tag", 0])
                i += 1
            elif c == "{":
                stack.append(["expr", 0])
                i += 1
                regex_ok = True
            else:
                blank_out(chars, i, i + 1)
                i += 1
        elif c in " \t\r\n":
            i += 1
        elif two == "//":
            end = line_end(text, i)
            record(found, src, text, i, end, False)
            blank_out(chars, i, end)
            i = end
        elif two == "/*":
            end = block_end(text, i, False)
            doc = text.startswith("/**", i) and not text.startswith("/**/", i)
            record(found, src, text, i, end, doc)
            blank_out(chars, i, end)
            i = end
        elif kind == "tag":
            if two == "/>":
                stack.pop()
                i += 2
                regex_ok = False
            elif c == ">":
                stack[-1] = ["text", 0]
                i += 1
            elif c in "'\"":
                end = text.find(c, i + 1)
                if end < 0:
                    raise Unreadable("unterminated JSX attribute")
                blank_out(chars, i, end + 1)
                i = end + 1
            elif c == "{":
                stack.append(["expr", 0])
                i += 1
                regex_ok = True
            else:
                i += 1
        elif c in "'\"":
            end = skip_quoted(text, i)
            blank_out(chars, i, end)
            i = end
            regex_ok = False
        elif c == "`":
            i, opened = template_chunk(text, chars, i)
            if opened:
                stack.append(["tpl", 0])
            regex_ok = opened
        elif c == "{":
            if stack:
                stack[-1][1] += 1
            i += 1
            regex_ok = True
        elif c == "}":
            if stack and stack[-1][1] == 0:
                resumed = stack.pop()[0]
                if resumed == "tpl":
                    i, opened = template_chunk(text, chars, i)
                    if opened:
                        stack.append(["tpl", 0])
                else:
                    i += 1
                regex_ok = False
                continue
            if stack:
                stack[-1][1] -= 1
            i += 1
            regex_ok = False
        elif c == "<" and jsx and regex_ok and jsx_opens(text, i):
            stack.append(["tag", 0])
            i += 1
        elif c == "/" and regex_ok:
            end = js_regex_end(text, i)
            if end is None:
                i += 1
            else:
                blank_out(chars, i, end)
                i = end
                regex_ok = False
        elif c in "+-" and text[i + 1:i + 2] == c:
            i += 2
        elif c == "/":
            i += 1
            regex_ok = True
        elif JS_WORD.match(text, i):
            m = JS_WORD.match(text, i)
            regex_ok = m.group(0) in JS_KEYWORDS_BEFORE_REGEX
            i = m.end()
        elif c.isdigit():
            i = JS_NUMBER.match(text, i).end()
            regex_ok = False
        else:
            regex_ok = c not in ")]"
            i += 1
    if any(entry[0] in ("text", "tag") for entry in stack):
        raise Unreadable("unterminated JSX")
    return found, "".join(chars)


def scan_jsx(text):
    return scan_js(text, True)


def js_regex_end(text, i):
    j = i + 1
    in_class = False
    while j < len(text):
        c = text[j]
        if c == "\n":
            return None
        if c == "\\":
            j += 2
            continue
        if c == "[":
            in_class = True
        elif c == "]":
            in_class = False
        elif c == "/" and not in_class:
            return j + 1
        j += 1
    return None


def rust_quote(text, chars, i):
    if text[i + 1:i + 2] == "\\":
        close = text.find("'", i + 3)
        if close >= 0:
            blank_out(chars, i, close + 1)
            return close + 1
    elif text[i + 2:i + 3] == "'":
        blank_out(chars, i, i + 3)
        return i + 3
    return i + 1


def scan_clike(text, language):
    src = Lines(text)
    chars = list(text)
    found = []
    n = len(text)
    rust = language == "rust"
    i = 0
    while i < n:
        c = text[i]
        two = text[i:i + 2]
        if two == "//" and language != "css":
            end = line_end(text, i)
            doc = rust and (
                (text.startswith("///", i) and not text.startswith("////", i)) or text.startswith("//!", i)
            )
            record(found, src, text, i, end, doc)
            blank_out(chars, i, end)
            i = end
        elif two == "/*":
            end = block_end(text, i, rust)
            doc = rust and (
                (text.startswith("/**", i) and not text.startswith(("/**/", "/***"), i))
                or text.startswith("/*!", i)
            )
            record(found, src, text, i, end, doc)
            blank_out(chars, i, end)
            i = end
        elif c == '"' or (c == "'" and not rust):
            end = skip_quoted(text, i, multiline=rust)
            blank_out(chars, i, end)
            i = end
        elif c == "`" and language == "go":
            end = text.find("`", i + 1)
            if end < 0:
                raise Unreadable("unterminated raw string")
            blank_out(chars, i, end + 1)
            i = end + 1
        elif rust and c == "'":
            i = rust_quote(text, chars, i)
        elif rust and (c.isalpha() or c == "_"):
            m = RUST_RAW.match(text, i)
            if not m:
                i = RUST_WORD.match(text, i).end()
                continue
            closing = '"' + m.group(1)
            end = text.find(closing, m.end())
            if end < 0:
                raise Unreadable("unterminated raw string")
            end += len(closing)
            blank_out(chars, i, end)
            i = end
        else:
            i += 1
    return found, "".join(chars)


def scan_go(text):
    found, blank = scan_clike(text, "go")
    lines = text.split("\n")
    marked = set()
    group = []
    standalone = [f for f in found if f.full.startswith("//") and lines[f.line - 1].lstrip().startswith("//")]
    for f in standalone + [None]:
        if group and (f is None or f.line != group[-1].line + 1):
            following = lines[group[-1].line] if group[-1].line < len(lines) else ""
            if GO_DECLARATION.match(following):
                marked.update(group)
            group = []
        if f is not None:
            group.append(f)
    return [f._replace(doc=True) if f in marked else f for f in found], blank


def scan_css(text):
    return scan_clike(text, "css")


def scan_rust(text):
    return scan_clike(text, "rust")


def header_colon(logical):
    head = logical[0][1]
    if not (head in ("def", "class") or (head == "async" and len(logical) > 1 and logical[1][1] == "def")):
        return None
    depth = 0
    for k, part in enumerate(logical):
        if part[0]:
            continue
        if part[1] in ("(", "[", "{"):
            depth += 1
        elif part[1] in (")", "]", "}"):
            depth -= 1
        elif part[1] == ":" and depth == 0:
            return k
    return None


def scan_python(text):
    src = Lines(text)
    chars = list(text)
    found = []
    logical = []
    first = True
    after_header = False
    depth = 0
    opened = 0
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        kind, string, begin, finish, _ = tok
        if kind == tokenize.COMMENT:
            start = src.index(begin[0], begin[1], len(text))
            stop = src.index(finish[0], finish[1], len(text))
            record(found, src, text, start, stop, False)
            blank_out(chars, start, stop)
        elif kind == FSTRING_START:
            if depth == 0:
                opened = src.index(begin[0], begin[1], len(text))
            depth += 1
        elif kind == FSTRING_END:
            depth -= 1
            if depth == 0:
                stop = src.index(finish[0], finish[1], len(text))
                blank_out(chars, opened, stop)
                logical.append((True, "", opened, stop))
        elif depth > 0:
            continue
        elif kind == tokenize.STRING:
            start = src.index(begin[0], begin[1], len(text))
            stop = src.index(finish[0], finish[1], len(text))
            blank_out(chars, start, stop)
            logical.append((True, string, start, stop))
        elif kind == tokenize.NEWLINE:
            if logical:
                colon = header_colon(logical)
                if all(part[0] for part in logical):
                    record(found, src, text, logical[0][2], logical[-1][3], first or after_header)
                elif colon is not None and colon + 1 < len(logical) and all(p[0] for p in logical[colon + 1:]):
                    record(found, src, text, logical[colon + 1][2], logical[-1][3], True)
                after_header = colon == len(logical) - 1
                first = False
                logical = []
        elif kind not in (tokenize.NL, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER, tokenize.ENCODING):
            logical.append((False, string, 0, 0))
    return found, "".join(chars)


def scan_shell(text):
    src = Lines(text)
    chars = list(text)
    found = []
    stack = []
    pending = []
    closed_plain = -1
    n = len(text)
    i = 0
    while i < n:
        c = text[i]
        top = stack[-1] if stack else None
        if c == "\\":
            i += 2
        elif top == "dq":
            if c == '"':
                stack.pop()
                i += 1
            elif text.startswith("$(", i):
                stack.append("cs")
                i += 2
            elif text.startswith("${", i):
                stack.append("pe")
                i += 2
            else:
                i += 1
        elif c == "'":
            end = text.find("'", i + 1)
            if end < 0:
                raise Unreadable("unterminated quote")
            i = end + 1
        elif c == '"':
            stack.append("dq")
            i += 1
        elif c == "$":
            two = text[i:i + 2]
            if two == "$'":
                j = i + 2
                while j < n and text[j] != "'":
                    j += 2 if text[j] == "\\" else 1
                if j >= n:
                    raise Unreadable("unterminated quote")
                i = j + 1
            elif text.startswith("$((", i):
                stack.append("arith")
                i += 3
            elif two == "$(":
                stack.append("cs")
                i += 2
            elif two == "${":
                stack.append("pe")
                i += 2
            elif two[1:] and two[1] in "#?$!@*-_":
                i += 2
            else:
                i += 1
        elif c == "(":
            if text.startswith("((", i):
                stack.append("arith")
                i += 2
            else:
                stack.append("paren")
                i += 1
        elif c == ")":
            if top == "arith" and text.startswith("))", i):
                stack.pop()
                i += 2
                continue
            if top == "paren":
                closed_plain = i
            if top in ("cs", "paren"):
                stack.pop()
            i += 1
        elif c == "}" and top == "pe":
            stack.pop()
            i += 1
        elif c == "#" and top != "pe" and (
            i == 0 or text[i - 1] in " \t\r\n;|&(" or (text[i - 1] == ")" and closed_plain == i - 1)
        ):
            end = line_end(text, i)
            record(found, src, text, i, end, False)
            blank_out(chars, i, end)
            i = end
        elif c == "\n":
            i += 1
            if pending:
                i = consume_heredocs(text, chars, src, found, pending, i)
                pending = []
        elif c == "<" and text.startswith("<<<", i):
            i += 3
        elif c == "<" and top != "arith" and text.startswith("<<", i) and HEREDOC.match(text, i):
            m = HEREDOC.match(text, i)
            delimiter = next(g for g in m.groups()[1:] if g is not None)
            prefix = text[text.rfind("\n", 0, i) + 1:i]
            pending.append((delimiter, m.group(1) == "-", bool(PYTHON_WORD.search(prefix))))
            i = m.end()
        else:
            i += 1
    if pending:
        raise Unreadable("heredoc without a body")
    return found, "".join(chars)


def consume_heredocs(text, chars, src, found, pending, i):
    for delimiter, strip_tabs, python in pending:
        body_start = i
        while True:
            if i >= len(text):
                raise Unreadable("unterminated heredoc")
            end = line_end(text, i)
            line = text[i:end].rstrip("\r")
            if strip_tabs:
                line = line.lstrip("\t")
            if line == delimiter:
                break
            i = end + 1
        body = text[body_start:i]
        if python:
            inner, blank = scan_python(body)
            offset = src.at(body_start) - 1
            found.extend(f._replace(line=f.line + offset, end=f.end + offset) for f in inner)
            chars[body_start:i] = list(blank)
        else:
            blank_out(chars, body_start, i)
        i = line_end(text, i) + 1
    return i


def scan_embedded(text, src, start, end, scanner, found, chars):
    body = text[start:end]
    inner, blank = scanner(body)
    offset = src.at(start) - 1
    found.extend(f._replace(line=f.line + offset, end=f.end + offset, doc=False) for f in inner)
    chars[start:end] = list(blank)


def scan_html(text):
    src = Lines(text)
    chars = list(text)
    found = []
    i = 0
    while True:
        m = HTML_TOKEN.search(text, i)
        if not m:
            break
        if m.group(0) == "<!--":
            end = text.find("-->", m.end())
            if end < 0:
                raise Unreadable("unterminated comment")
            end += 3
            record(found, src, text, m.start(), end, False)
            blank_out(chars, m.start(), end)
            i = end
            continue
        tag = m.group(1).lower()
        close = re.compile("</" + tag, re.I).search(text, m.end())
        if not close:
            raise Unreadable("unterminated " + tag)
        i = close.start()
        declared = HTML_SCRIPT_TYPE.search(m.group(2))
        if tag == "script" and declared and "script" not in declared.group(1).lower() and declared.group(1) != "module":
            continue
        scan_embedded(text, src, m.end(), i, scan_js if tag == "script" else scan_css, found, chars)
    return found, "".join(chars)


SCANNERS = {
    "shell": scan_shell,
    "python": scan_python,
    "js": scan_jsx,
    "ts": scan_js,
    "go": scan_go,
    "rust": scan_rust,
    "css": scan_css,
    "html": scan_html,
}


def licence_block(found, blank):
    first_code = next((n for n, line in enumerate(blank.split("\n"), 1) if line.strip()), None)
    block = []
    edge = 0
    for f in sorted(found):
        if f.line == 1 and f.full.startswith("#!"):
            continue
        if (first_code is not None and f.line >= first_code) or not COMMENT_START.match(f.full):
            break
        if block and f.line > edge + 1:
            break
        block.append(f)
        edge = f.end
    if LICENCE.search("\n".join(f.full for f in block)):
        return set(block)
    return set()


def judge(language, text):
    found, blank = SCANNERS[language](text)
    protected = licence_block(found, blank)
    source = text.split("\n")
    entries = []
    for f in found:
        if f in protected or (f.line == 1 and f.full.startswith("#!")):
            continue
        if SUPPRESSION_COMMENT.search(f.full):
            entries.append(("suppression", f.line, f.end, f.text))
        elif DIRECTIVE.search(f.full):
            continue
        elif f.doc:
            entries.append(("doc", f.line, f.end, f.text))
        else:
            entries.append(("comment", f.line, f.end, f.text))
    pattern = CODE_SUPPRESSION.get(language)
    if pattern:
        for number, line in enumerate(blank.split("\n"), 1):
            if pattern.search(line):
                entries.append(("suppression", number, number, source[number - 1].strip()))
    return entries


def read_text(path):
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8").removeprefix("﻿")


def scratch_index(top, untracked, scratch):
    index = os.path.join(scratch, "index")
    real = os.path.join(top, run(["git", "-C", top, "rev-parse", "--git-path", "index"]).stdout.strip())
    if os.path.exists(real):
        shutil.copy2(real, index)
    os.environ["GIT_INDEX_FILE"] = index
    if untracked:
        listing = subprocess.run(
            ["git", "--literal-pathspecs", "-C", top, "add", "-N", "--pathspec-from-file=-", "--pathspec-file-nul"],
            input="\0".join(sorted(untracked)) + "\0", capture_output=True, text=True,
        )
        if listing.returncode != 0:
            die(f"git add -N: {listing.stderr.strip()}", 2)


def changed_paths(top, ref):
    parts = [p for p in run(["git", "-C", top, "diff", "-z", "--name-status", "-M", "--diff-filter=d", ref, "--"]).stdout.split("\0") if p]
    changed = {}
    i = 0
    while i < len(parts):
        if parts[i][0] in "RC":
            changed[parts[i + 2]] = parts[i + 1]
            i += 3
        else:
            changed[parts[i + 1]] = parts[i + 1]
            i += 2
    return changed


def added_lines(top, ref, old, path):
    diff = run(["git", "--literal-pathspecs", "-C", top, "diff", "-U0", "-M", "--no-color", "--no-ext-diff", ref, "--", old, path]).stdout
    lines = set()
    for m in HUNK.finditer(diff):
        start = int(m.group(1))
        count = 1 if m.group(2) is None else int(m.group(2))
        lines.update(range(start, start + count))
    return lines


def git_names(top, *args):
    return [p for p in run(["git", "-C", top, *args]).stdout.split("\0") if p]


def parse(argv):
    library = False
    every = False
    refs = []
    for a in argv:
        if a == "--library":
            library = True
        elif a == "--all":
            every = True
        elif a.startswith("-"):
            die(USAGE)
        else:
            refs.append(a)
    if len(refs) > 1 or (every and refs):
        die(USAGE)
    return library, every, (refs[0] if refs else "HEAD")


def main():
    with tempfile.TemporaryDirectory() as scratch:
        report(scratch, *parse(sys.argv[1:]))


def report(scratch, library, every, ref):
    top_run = run(["git", "rev-parse", "--show-toplevel"], check=False)
    if top_run.returncode != 0:
        die("not inside a git work tree")
    top = top_run.stdout.strip()
    untracked = set(git_names(top, "ls-files", "-z", "--others", "--exclude-standard"))
    origins = {}
    if every:
        ref = None
        names = git_names(top, "ls-files", "-z") + sorted(untracked)
    else:
        if run(["git", "-C", top, "rev-parse", "--verify", "--quiet", ref + "^{commit}"], check=False).returncode != 0:
            die(f"unknown ref: {ref}")
        scratch_index(top, untracked, scratch)
        origins = changed_paths(top, ref)
        names = list(origins)
    fix, docs, existing, unread = [], [], [], []
    scanned = 0
    for path in sorted(set(names)):
        base = os.path.basename(path)
        language = EXTENSIONS.get(os.path.splitext(base)[1])
        full = os.path.join(top, path)
        if not language or ".config." in base or base.startswith(".") or os.path.islink(full) or not os.path.isfile(full):
            continue
        added = None if every else added_lines(top, ref, origins.get(path, path), path)
        try:
            entries = judge(language, read_text(full))
        except READ_ERRORS:
            unread.append(path)
            continue
        scanned += 1
        for kind, line, end, text in entries:
            entry = {"path": path, "line": line, "text": text}
            if kind == "suppression":
                if added is None or any(n in added for n in range(line, end + 1)):
                    fix.append({**entry, "kind": "suppression"})
                else:
                    existing.append(entry)
            elif kind == "doc" and library:
                docs.append(entry)
            else:
                fix.append({**entry, "kind": kind})
    for bucket in (fix, docs, existing):
        bucket.sort(key=lambda e: (e["path"], e["line"]))
    status = "found" if fix or unread else "clean"
    print(json.dumps(
        {"status": status, "ref": ref, "scanned": scanned, "fix": fix, "doc": docs, "existing": existing, "unread": unread},
        ensure_ascii=False,
        indent=1,
    ))
    sys.exit(1 if status == "found" else 0)


if __name__ == "__main__":
    main()
