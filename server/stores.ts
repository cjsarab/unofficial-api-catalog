import { createSecretStore, type SecretStore } from "./auth/secrets.ts";
import { createEnvironmentStore, type EnvironmentStore } from "./environments/store.ts";
import { ENVIRONMENTS_PATH, SECRETS_PATH } from "./config.ts";

// Runtime-singleton stores. Both the env-CRUD route handler and the Ethos
// proxy used to call createEnvironmentStore() / createSecretStore() in their
// own modules; that gave each callsite an independent in-memory cache, so a
// `setActive` from the routes side never propagated to the proxy and the
// proxy kept using the previous env's API key. One shared instance fixes
// that without giving up the file-read cache.

let _secrets: SecretStore | undefined;
let _envs: EnvironmentStore | undefined;

export function getSecretStore(): SecretStore {
  if (!_secrets) _secrets = createSecretStore(SECRETS_PATH);
  return _secrets;
}

export function getEnvironmentStore(): EnvironmentStore {
  if (!_envs) _envs = createEnvironmentStore(ENVIRONMENTS_PATH, getSecretStore());
  return _envs;
}
