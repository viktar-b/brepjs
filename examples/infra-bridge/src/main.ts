import { InfraBridge } from './model/infraBridge.js';
import { loadProjectFont } from './fonts/projectFont.js';

/** Load owned assets and build the reference-independent authored Model. */
export async function buildInfraBridge() {
  await loadProjectFont();
  return InfraBridge({ key: 'infra-bridge' });
}
