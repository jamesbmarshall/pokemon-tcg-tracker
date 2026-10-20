import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyField, Modal } from './forms';

describe('Modal', () => {
  it('bounds the scrollable dialog to the viewport and restores background scrolling on close', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<Modal title="Share wishlist" onClose={() => {}}>Long content</Modal>);
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog').querySelector('[data-dialog-content]')).toHaveClass('max-h-[calc(100dvh-2rem)]', 'overflow-y-auto', 'overscroll-contain');
    unmount();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });
});

describe('CopyField', () => {
  it('confirms copying after the clipboard succeeds', async () => {
    const user = userEvent.setup();
    render(<CopyField value="https://cards.example/s/token" />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await navigator.clipboard.readText()).toBe('https://cards.example/s/token');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('selects the link and explains manual copying when clipboard access fails', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Blocked'));
    render(<CopyField value="https://cards.example/s/token" />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(screen.getByRole('status')).toHaveTextContent('Select and copy the link above');
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    write.mockRestore();
  });
});
