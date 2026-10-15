# A connected five-minute walkthrough

1. Open the Mentor Workspace. The workspace is clearly identified as prepared sample data. Select **Input validation**; inspect `validate.ts`, its highlighted condition, and the evidence tab.
2. Choose **Follow a request**. Step through signup. At the validation checkpoint, predict whether invalid input reaches the service. At the duplicate-email checkpoint, intentionally try an incorrect answer, then retry; the first attempt remains recorded.
3. Complete the success path and open **Practice**. Run the original prepared checks: letters-only passwords fail the new requirement. Reveal a hint, apply the guided example, then run the simulated checks again. Point out that no actual execution is claimed.
4. Open **Knowledge & decisions**. Use or write an explanation, save a draft, submit it for review, approve as the local demo maintainer, and explicitly publish. Return to the mentor to see the approved demo rationale.
5. Open **Changes**, PR #42. Select the new verification step to update the diff. Inspect the login guard and the setup delta. The external delivery boundary stays unverified.
6. Start the relearning journey. The head snapshot introduces a verified-email prediction. Completing a failure scenario does not clear review of the changed success path.
7. Reopen knowledge: the base explanation now needs review. **My progress** retains first attempts and previous studied revisions while showing only the concepts affected by the prepared change.

Useful alternatives: change the learner profile and goal to show different routes; use Ctrl/⌘ K to find a component; use the component-list alternative on mobile; select PR #39 to inspect a separate proposed regression test rather than claiming it was part of the canonical head snapshot.
