import { pathToFileURL } from 'node:url';
const mod=await import(pathToFileURL(process.env.TESTCAFE_PACKAGE+'/lib/ohos/foreground.mjs'));
export const {ensureForeground, keepForeground}=mod;
