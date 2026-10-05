import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardSkeletonGrid, EmptyState, Energy, ErrorState, Logo, PageHeader, ProgressBar, ProgressRing, Segmented, Skeleton } from './ui';

describe('Logo', () => {
  it('renders a decorative svg at the requested size', () => {
    const { container } = render(<Logo size={40} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '40');
    expect(svg).toHaveAttribute('aria-hidden');
  });
});

describe('Energy', () => {
  it('uses the type as its title', () => {
    render(<Energy type="Fire" />);
    expect(screen.getByTitle('Fire')).toBeInTheDocument();
  });

  it('falls back to Colorless styling for unknown types but keeps a custom title', () => {
    render(<Energy type="Mystery" title="Unknown energy" size={30} />);
    const el = screen.getByTitle('Unknown energy');
    expect(el).toHaveStyle({ width: '30px', height: '30px' });
  });
});

describe('ProgressRing', () => {
  it('shows a floored percentage by default', () => {
    render(<ProgressRing value={1} total={3} />);
    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('renders a custom label', () => {
    render(<ProgressRing value={1} total={2} label="1/2" />);
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('switches to the holo stroke once complete', () => {
    const { container } = render(<ProgressRing value={5} total={5} />);
    const circles = container.querySelectorAll('circle');
    expect(circles[1]).toHaveAttribute('stroke', 'url(#ring-holo)');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('treats an empty total as 0%', () => {
    const { container } = render(<ProgressRing value={0} total={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(container.querySelectorAll('circle')[1]).toHaveAttribute('stroke', 'var(--color-volt)');
  });
});

describe('ProgressBar', () => {
  it('sets the fill width from value/total', () => {
    const { container } = render(<ProgressBar value={1} total={4} />);
    const fill = container.firstChild!.firstChild as HTMLElement;
    expect(fill.style.width).toBe('25%');
    expect(fill).toHaveClass('bg-volt');
  });

  it('caps at 100% and uses the holo bar when complete', () => {
    const { container } = render(<ProgressBar value={12} total={10} className="extra" />);
    expect(container.firstChild).toHaveClass('extra');
    const fill = container.firstChild!.firstChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
    expect(fill).toHaveClass('holo-bar');
  });

  it('is empty when the total is zero', () => {
    const { container } = render(<ProgressBar value={3} total={0} />);
    expect((container.firstChild!.firstChild as HTMLElement).style.width).toBe('0%');
  });
});

describe('Skeleton & CardSkeletonGrid', () => {
  it('renders a pulsing block with extra classes', () => {
    const { container } = render(<Skeleton className="h-10" />);
    expect(container.firstChild).toHaveClass('animate-pulse', 'h-10');
  });

  it('renders the requested number of card placeholders', () => {
    const { container } = render(<CardSkeletonGrid count={4} />);
    expect(container.firstChild!.childNodes).toHaveLength(4);
  });

  it('defaults to 18 placeholders', () => {
    const { container } = render(<CardSkeletonGrid />);
    expect(container.firstChild!.childNodes).toHaveLength(18);
  });
});

describe('ErrorState', () => {
  it('shows the error message and a retry button', async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn't load" error={new Error('Timeout')} onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load");
    expect(alert).toHaveTextContent('Timeout');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses a generic message for non-Error values and hides retry without a handler', () => {
    render(
      <ErrorState title="Oops" error="nope">
        <a href="/x">Go back</a>
      </ErrorState>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go back' })).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the icon, title, body and action', () => {
    render(<EmptyState icon={<span data-testid="icon" />} title="Nothing here" action={<button>Do it</button>}>Some help</EmptyState>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Some help')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
  });

  it('omits the body and action when not given', () => {
    const { container } = render(<EmptyState icon={null} title="Bare" />);
    expect(container.querySelectorAll('.mt-2, .mt-6')).toHaveLength(0);
  });
});

describe('PageHeader', () => {
  it('renders the title as h1 with eyebrow, children and actions', () => {
    render(
      <PageHeader eyebrow="3 cards" title="Collection" actions={<button>Act</button>}>
        Details
      </PageHeader>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Collection' })).toBeInTheDocument();
    expect(screen.getByText('3 cards')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });

  it('renders just a title', () => {
    render(<PageHeader title="Settings" />);
    expect(screen.getByRole('banner')).toHaveTextContent(/^Settings$/);
  });
});

describe('Segmented', () => {
  const options = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta', title: 'Second option' },
  ];

  it('marks the selected option as checked', () => {
    render(<Segmented value="a" onChange={() => {}} options={options} />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Second option' })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onChange with the option value', async () => {
    const onChange = vi.fn();
    render(<Segmented value="a" onChange={onChange} options={options} size="sm" />);
    await userEvent.click(screen.getByRole('radio', { name: 'Second option' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('supports numeric values', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value={9}
        onChange={onChange}
        options={[
          { value: 9, label: '9' },
          { value: 12, label: '12' },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole('radio', { name: '12' }));
    expect(onChange).toHaveBeenCalledWith(12);
  });
});
