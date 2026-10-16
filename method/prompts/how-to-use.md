# How to Use the Plebeian Apps LLM Team Constitution

## The whole idea

**You stay in charge. One LLM plans, one LLM edits, and a different LLM checks the work.** The Constitution is their shared rulebook.

## 1. Open the right LLM conversations

For a normal change, use three separate conversations:

| Role                | Job                                                   | Can edit?                  |
| ------------------- | ----------------------------------------------------- | -------------------------- |
| **Architect (A0)**  | Understands the problem and writes a small work order | No                         |
| **Builder (A1)**    | Makes only the approved change                        | Yes, if explicitly allowed |
| **Red Team A (A2)** | Tries to find mistakes in the finished change         | No                         |

For payments, keys, identity, migrations, production servers, or cryptography, also use **Red Team B (A3)** and a **Final Reviewer (A4)**.

## 2. Give every LLM the Constitution and one role

Attach or paste the complete Constitution at the start of each conversation. Then say:

```text
Use the Plebeian Apps LLM Team Constitution.
Your only role is A0 — Architect / Integrator.
I am the human maintainer and retain final approval.
```

Change `A0` to the role needed for that conversation. Never ask one LLM to plan, build, and approve the same change.

## 3. Ask the Architect for a small work order

Describe the problem in normal language:

```text
ROLE: A0 — Architect / Integrator
PROJECT: [example: Plebeian Market]
REPOSITORY: [name or link]
GOAL: [what should improve?]
PROBLEM: [what is happening now?]
MUST NOT CHANGE: [important limits]

Check current local and upstream evidence first.
Do not edit code. Produce the smallest safe Builder task packet.
Leave permissions as “no” unless they are required.
```

Before approving the packet, check that it clearly says:

- what is included and excluded;
- which files may change;
- which behavior must remain safe;
- which tests must pass;
- when the Builder must stop;
- exactly what the Builder may do.

## 4. Check permissions yourself

If you do not understand or need an action, leave it as **no**. A normal safe packet usually starts like this:

```text
READ_LOCAL: yes
READ_REMOTE: yes
EDIT_LOCAL: yes       # Builder only, named files/worktree only
CREATE_BRANCH: no
INSTALL_OR_UPDATE_DEPENDENCIES: no
COMMIT: no
PUSH: no
GITHUB_WRITE: no
NOSTR_WRITE: no
DEPLOY_OR_RESTART: no
SECRET_ACCESS: no
REAL_VALUE_ACTIONS: no
```

Only the Builder should receive `EDIT_LOCAL: yes`.

## 5. Give the approved packet to the Builder

Paste the Architect's packet unchanged:

```text
Use the Constitution.
Your only role is A1 — Builder / Primary Local Implementer.

Verify the repository and branch, then implement only the approved packet below.
Do not commit, push, deploy, or widen scope.
Stop if the packet conflicts with the code or a permission is missing.

[PASTE APPROVED TASK PACKET]
```

The Builder should report changed files, tests run, tests not run, remaining risks, and a verdict. The Builder never approves its own work.

## 6. Send the result to an independent reviewer

Give Red Team A the same task packet and the exact finished candidate:

```text
Use the Constitution.
Your only role is A2 — Red Team A / Broad Adversarial Reviewer.
Remain read-only. Review the exact candidate against the approved packet.
Perform your own review before reading the Builder's conclusions.
Do not edit or repair the code.

[PASTE TASK PACKET AND CANDIDATE DETAILS]
```

Use the verdict like this:

| Verdict                      | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `FREEZE`                     | Ready for human review                                  |
| `FREEZE_WITH_MINOR_NOTES`    | Usually ready; read the notes                           |
| `MICRO_HARDEN`               | Architect defines one small repair; Builder performs it |
| `BLOCK`                      | Stop; do not merge or deploy                            |
| `ARCHITECTURE_CONTRADICTION` | Maintainers must resolve the design first               |

After a repair, review the new candidate again. High-risk work also gets Red Team B and the blind Final Reviewer.

## 7. Activate only the specialist rules you need

| Work involves…                        | Activate…                        |
| ------------------------------------- | -------------------------------- |
| Events, relays, signers, messaging    | **Nostr**                        |
| Invoices, wallets, proofs, settlement | **Bitcoin/Lightning/Cashu/Coco** |
| Offers, orders, shipping, reviews     | **Open Markets**                 |
| Mesh networking, discovery, gateways  | **FIPS**                         |
| Servers, DNS, CI/CD, deployment       | **DevOps**                       |
| Models, prompts, automated decisions  | **AI/ML**                        |
| Remote pages, components, publishing  | **Napplets/nsites/CMS**          |
| Dependencies, licenses, self-hosting  | **FOSS/freedom-tech**            |

Do not activate every overlay for every task.

## Final human check

You decide whether to commit, push, merge, release, deploy, or use real funds. No LLM verdict replaces that decision.

Remember: **describe → architect → approve packet → build → review → repair if needed → human decision.**
