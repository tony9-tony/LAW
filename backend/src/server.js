import { app } from './app.js';
import { config } from './config.js';

export const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
});