import { normalizePackages } from './build.mjs';
import { loadPort } from './port.mjs';

const port = loadPort(process.env.NPM_PORTS_ROOT, process.env.NPMBUILD_DIR);
normalizePackages(port, process.env.NPMBUILD_SLOT);
