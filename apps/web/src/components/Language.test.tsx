import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageBadge, LanguagePicker } from './Language';

describe('Language components', () => {
  it('only badges non-English ids', () => {
    const { container, rerender } = render(<LanguageBadge id="sv03-001" />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LanguageBadge id="ja:SV4a-001" />);
    expect(screen.getByTitle('Japanese')).toHaveTextContent('JP');
  });

  it('lists every language and reports the choice', async () => {
    const onChange = vi.fn();
    render(<LanguagePicker value="en" onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Card language' });
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Japanese · 日本語' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'ko');
    expect(onChange).toHaveBeenCalledWith('ko');
  });
});
