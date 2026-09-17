interface Option<T extends string> {
  id: T
  label: string
  /** Shown after the label, e.g. a result count. */
  hint?: string
}

interface Props<T extends string> {
  options: Option<T>[]
  value: T
  className?: string
  /** Выбор виден, но недоступен — когда его отменяет настройка выше. */
  disabled?: boolean
  onChange: (value: T) => void
}

/**
 * The wireframe's `.hseg` control. Buttons rather than spans: the styling hangs
 * off `aria-pressed`, and a segmented filter has to be reachable by keyboard.
 */
export function Segmented<T extends string>({
  options,
  value,
  className,
  disabled,
  onChange
}: Props<T>): JSX.Element {
  return (
    <div className={`seg ${disabled ? 'seg--off' : ''} ${className ?? ''}`} role="group">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.hint !== undefined && <span className="seg__hint">{option.hint}</span>}
        </button>
      ))}
    </div>
  )
}
