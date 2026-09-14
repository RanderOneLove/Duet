interface Props {
  kind: 'loading' | 'empty' | 'error'
  title: string
  hint?: string
  onRetry?: () => void
}

/** Wireframe 2m: the three states every catalogue screen can land in. */
export function StateBlock({ kind, title, hint, onRetry }: Props): JSX.Element {
  if (kind === 'loading') {
    return (
      <div className="stateblock__skeleton">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeletonrow">
            <div className="skeletonrow__art" />
            <div className="skeletonrow__lines">
              <i style={{ width: `${54 + ((i * 13) % 30)}%` }} />
              <i style={{ width: `${28 + ((i * 7) % 20)}%` }} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (kind === 'empty') {
    return (
      <div className="stateblock__empty">
        <div className="stateblock__empty-icon" />
        <div className="stateblock__empty-title">{title}</div>
        {hint && <div className="muted stateblock__hint" style={{ marginTop: 0 }}>{hint}</div>}
      </div>
    )
  }

  return (
    <div className="stateblock">
      <div className="stateblock__mark stateblock__mark--error" />
      <div className="stateblock__title">{title}</div>
      {hint && <div className="muted stateblock__hint">{hint}</div>}
      {onRetry && (
        <button className="pill pill--outline pill--sm" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  )
}
