import { z } from "zod";

const principalSchema = z
  .object({
    userId: z.string().trim().min(1).max(200),
    demo: z.boolean().optional(),
    repositoryRoles: z
      .record(
        z.string().url(),
        z.enum(["viewer", "contributor", "maintainer"]),
      )
      .default({}),
  })
  .strict();

export function createDecisionMemoryAuth(
  resolvePrincipal = async () => null,
) {
  if (typeof resolvePrincipal !== "function")
    throw new TypeError("resolvePrincipal must be a function");

  return async function decisionMemoryAuth(req, _res, next) {
    try {
      req.auth = null;
      const principal = await resolvePrincipal(req);
      req.auth = principal === null ? null : principalSchema.parse(principal);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next(
          Object.assign(
            new Error("Trusted authentication adapter returned an invalid identity"),
            { status: 500, cause: error },
          ),
        );
      }
      next(error);
    }
  };
}

function demoModeEnabled() {
  if (process.env.F07_DEMO_MODE === "true") return true;
  if (process.env.F07_DEMO_MODE === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export const decisionMemoryAuth = createDecisionMemoryAuth(async () =>
  demoModeEnabled()
    ? {
        userId: "f07-demo-user",
        demo: true,
        repositoryRoles: {},
      }
    : null,
);
