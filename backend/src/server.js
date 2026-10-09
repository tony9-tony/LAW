import { app } from './app.js';
import { config } from './config.js';

import { warmUpAi } from './services/support.service.js';

export const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    warmUpAi();
});