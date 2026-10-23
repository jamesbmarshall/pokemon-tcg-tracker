/** Real HTTP app and built SPA; disposable SQLite and no live provider dependencies. */
import { resolve } from 'node:path';
import {
  startServer,
  setupOwner,
  personalId,
} from '../apps/server/test/helpers.ts';
import { saveSnapshots } from '../apps/server/src/cards.ts';
import { saveGameCards } from '../apps/server/src/tcg/provider.ts';
import { magicLeader, magicForest } from './tcg-fixtures.ts';
export async function startBrowserServer() {
  const server = await startServer({ WEB_DIR: resolve('apps/web/dist') });
  try {
    const owner = await setupOwner(server.app);
    const collection = await personalId(owner);
    saveGameCards(server.ctx, [magicLeader, magicForest]);
    saveSnapshots(server.ctx.db, [
      {
        id: 'sv1-001',
        name: 'Browser fixture card',
        number: '001',
        setId: 'sv1',
        setName: 'Fixture set',
        series: 'Fixture',
        releaseDate: '2024-01-01',
        printedTotal: 100,
        supertype: 'Pokémon',
        image: '',
        imageLarge: '',
        variants: ['normal'],
        prices: { normal: 123.45 },
        syncedAt: new Date().toISOString(),
      },
    ]);
    await owner.put(`/api/collections/${collection}/entries`, {
      entries: [
        {
          cardId: 'sv1-001',
          variant: 'normal',
          quantity: 1,
          paid: { amount: 987.65, currency: 'USD' },
        },
      ],
    });
    const url = await server.app.listen({ host: '127.0.0.1', port: 0 });
    server.ctx.config.publicUrl = url;
    return { ...server, url };
  } catch (error) {
    await server.close();
    throw error;
  }
}
