import {startDev} from '../dev.mjs';

// The second service waits for Vite readiness before failing intentionally.
startDev({names:['dev:web','dev:failure-after-start']});
