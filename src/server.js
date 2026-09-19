require('dotenv').config({ quiet: true });
const { startSupervisor } = require('./services/server.supervisor');

if (require.main === module) startSupervisor();
