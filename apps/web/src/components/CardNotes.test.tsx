import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import CardNotes from './CardNotes';
import { NOTE_MAX, useCollectionStore } from '../store/collectionStore';
import { resetStores, seedCollection } from '../test/ui-helpers';

const setNote = vi.fn(async (cardId: string, text: string) => {
  const notes = new Map(useCollectionStore.getState().notes);
  if (text.trim()) notes.set(cardId, text.trim());
  else notes.delete(cardId);
  useCollectionStore.setState({ notes });
});

beforeEach(() => {
  resetStores();
  seedCollection({ notes: { 'sv03-001': 'Bought at a card fair' } });
  useCollectionStore.setState({ setNote });
  setNote.mockClear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const box = () => screen.getByRole('textbox', { name: 'Notes about this card' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe('CardNotes', () => {
  it('shows the saved note and a privacy hint', () => {
    render(<CardNotes cardId="sv03-001" />);
    expect(screen.getByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    expect(box()).toHaveValue('Bought at a card fair');
    expect(box()).toHaveAttribute('maxLength', String(NOTE_MAX));
    expect(screen.getByText('Only you can see this')).toBeInTheDocument();
  });

  it('autosaves after a pause in typing and confirms', async () => {
    render(<CardNotes cardId="sv03-002" />);
    expect(box()).toHaveValue('');
    type('Swapped');
    type('Swapped with Sam');
    await act(() => vi.advanceTimersByTimeAsync(699));
    expect(setNote).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(setNote).toHaveBeenCalledOnce();
    expect(setNote).toHaveBeenCalledWith('sv03-002', 'Swapped with Sam');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1800));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('saves immediately on blur, and does not save unchanged text', async () => {
    render(<CardNotes cardId="sv03-001" />);
    fireEvent.blur(box());
    type('Bought at a card fair  ');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(setNote).not.toHaveBeenCalled();
    type('Bought at a card fair, £4');
    fireEvent.blur(box());
    expect(setNote).toHaveBeenCalledWith('sv03-001', 'Bought at a card fair, £4');
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(setNote).toHaveBeenCalledOnce();
  });

  it('flushes an unsaved edit when leaving the card', () => {
    const { unmount } = render(<CardNotes cardId="sv03-001" />);
    type('');
    unmount();
    expect(setNote).toHaveBeenCalledWith('sv03-001', '');
  });

  it('counts down characters near the limit', () => {
    render(<CardNotes cardId="sv03-002" />);
    type('x'.repeat(NOTE_MAX - 12));
    expect(screen.getByText('12 left')).toBeInTheDocument();
  });
});
