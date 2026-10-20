/** Real HTTP app and built SPA; disposable SQLite and no live provider dependencies. */
import { resolve } from 'node:path';
import { startServer, setupOwner, personalId } from '../apps/server/test/helpers.ts';
import { saveSnapshots } from '../apps/server/src/cards.ts';
const server = await startServer({ WEB_DIR: resolve('apps/web/dist'), PUBLIC_URL: 'http://127.0.0.1:4173' });
const owner = await setupOwner(server.app);
const collection = await personalId(owner);
saveSnapshots(server.ctx.db, [{ id: 'sv1-001', name: 'Browser fixture card', number: '001', setId: 'sv1', setName: 'Fixture set', series: 'Fixture', releaseDate: '2024-01-01', printedTotal: 100, supertype: 'Pokémon', image: '', imageLarge: '', variants: ['normal'], prices: { normal: 123.45 }, syncedAt: new Date().toISOString() }]);
await owner.put(`/api/collections/${collection}/entries`, { entries: [{ cardId: 'sv1-001', variant: 'normal', quantity: 1, paid: { amount: 987.65, currency: 'USD' } }] });
await server.app.listen({ host: '127.0.0.1', port: 4173 });
const shutdown = async () => { await server.close(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
