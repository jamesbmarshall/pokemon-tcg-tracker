import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ThemeToggle from './ThemeToggle';
import { useSettings } from '../store/settingsStore';

beforeEach(() => useSettings.setState({ theme: 'system' }));

describe('ThemeToggle', () => {
  it('cycles system → light → dark → system', async () => {
    render(<ThemeToggle />);
    const btn = () => screen.getByRole('button');
    expect(btn()).toHaveAccessibleName('Theme: System. Switch to Light');
    await userEvent.click(btn());
    expect(useSettings.getState().theme).toBe('light');
    expect(btn()).toHaveAccessibleName('Theme: Light. Switch to Dark');
    await userEvent.click(btn());
    expect(useSettings.getState().theme).toBe('dark');
    await userEvent.click(btn());
    expect(useSettings.getState().theme).toBe('system');
  });
});
