import { pathToFileURL } from 'node:url';
const mod=await import(pathToFileURL(process.env.TESTCAFE_PACKAGE+'/lib/ohos/aa-launcher.mjs'));
export const {launchHaitai}=mod;
