import { useState } from 'react';
import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NativeDialog from './NativeDialog';
import { Segmented } from './ui';

it('places focus inside and restores the triggering control after Escape', async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Open editor</button>{open && <NativeDialog label="Editor" onClose={() => setOpen(false)}><button>First field</button><button>Last field</button></NativeDialog>}</>;
  }
  render(<Example />); const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Open editor' }));
  expect(screen.getByRole('button', { name: 'First field' })).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open editor' })).toHaveFocus();
});

it('implements radio-group arrows, wrapping and one Tab stop', async () => {
  function Example() {
    const [value, setValue] = useState('grid');
    return <><Segmented label="Collection view" value={value} onChange={setValue} options={[{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }]} /><button>After views</button></>;
  }
  render(<Example />); const user = userEvent.setup();
  await user.tab(); expect(screen.getByRole('radio', { name: 'Grid' })).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'List' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'List' })).toHaveFocus();
  await user.keyboard('{ArrowRight}'); expect(screen.getByRole('radio', { name: 'Grid' })).toHaveFocus();
  await user.tab(); expect(screen.getByRole('button', { name: 'After views' })).toHaveFocus();
});
