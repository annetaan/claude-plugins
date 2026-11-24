<if task>
Task <k> of the plan in <WORKDIR>/plan.md passed review. Turn its changes into **one commit**. Match the commit message style this repository already uses and make the task recognisable. Check that `git status --porcelain` is empty afterwards and report back.
<if issue>
The subject names the task. When the plan has one task, it names the issue's title, which the first line of <WORKDIR>/design.md holds after `# Issue #<n>: `.
<end>
<end>
<if integration>
The integration review passed. Turn its fixes into **one commit**, with a subject that says what it is, such as "integration review fixes". Check that `git status --porcelain` is empty afterwards and report back.
<end>
<if merge>
The merge passed review. Run `git add -A`, then `git commit --no-edit`, which records the merge with both parents and the message git prepared. Check that `git status --porcelain` prints nothing and that `git rev-parse --verify --quiet MERGE_HEAD` fails, and report back.
<end>

End the report with **notes for the next session, five lines at most**: the commands that run the tests and the type checks, the conventions you kept and the traps you hit, and anything that bears on the tasks still to come. No explanation of the code.
