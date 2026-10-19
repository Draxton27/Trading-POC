import {startDev} from '../dev.mjs';

// One npm script fails while Vite is starting; the launcher must stop Vite.
startDev({names:['dev:web','dev:missing-script']});
