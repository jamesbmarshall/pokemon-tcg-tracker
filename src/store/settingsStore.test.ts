import { beforeEach, describe, expect, it } from 'vitest';
import { useSettings } from './settingsStore';

const initial = useSettings.getState();
beforeEach(() => useSettings.setState(initial, true));

describe('settings store', () => {
  it('defaults to GBP, 9-pocket, grid, master mode, quick add off', () => {
    expect(useSettings.getState()).toMatchObject({ currency: 'GBP', pocketSize: 9, setView: 'grid', setMode: 'master', quickAdd: false });
  });

  it('updates each setting and persists to localStorage', () => {
    const s = useSettings.getState();
    s.setCurrency('EUR');
    s.setPocketSize(12);
    s.setSetView('binder');
    s.setSetMode('base');
    s.setQuickAdd(true);
    expect(useSettings.getState()).toMatchObject({ currency: 'EUR', pocketSize: 12, setView: 'binder', setMode: 'base', quickAdd: true });
    const saved = JSON.parse(localStorage.getItem('poketracker-settings')!);
    expect(saved.state).toMatchObject({ currency: 'EUR', pocketSize: 12, setView: 'binder', setMode: 'base', quickAdd: true });
  });

  it('rehydrates from storage', async () => {
    localStorage.setItem('poketracker-settings', JSON.stringify({ state: { currency: 'USD', pocketSize: 12 }, version: 0 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState()).toMatchObject({ currency: 'USD', pocketSize: 12, setView: 'grid' });
  });
});
