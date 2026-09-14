import { useState } from 'react'
import { SERVICE_META, type Connection, type ServiceId } from '@shared/domain'
import { ServiceLogo } from '../../shared/ServiceLogo'

interface Props {
  connections: Connection[]
  onConnect: (id: ServiceId) => Promise<void>
  onSkip: () => void
}

/**
 * Wireframe 2i. Each service is connected by signing in on its own site in a
 * real browser window — the app never sees a password, and there is no token
 * or cookie for the user to paste.
 */
export function ConnectScreen({ connections, onConnect, onSkip }: Props): JSX.Element {
  const [busy, setBusy] = useState<ServiceId | null>(null)
  const anyConnected = connections.some((connection) => connection.connected)

  const run = async (id: ServiceId): Promise<void> => {
    setBusy(id)
    try {
      await onConnect(id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="connect">
      <div className="connect__kicker muted">ПЕРВЫЙ ЗАПУСК</div>
      <h1 className="connect__title">Подключите музыку</h1>
      <p className="muted connect__lead">
        Добавьте один или оба сервиса — второй можно подключить позже в настройках.
      </p>

      <div className="connect__cards">
        {connections.map((connection) => (
          <div key={connection.service} className="connectcard">
            <div className={`connectcard__mark connectcard__mark--${connection.service}`}>
              <ServiceLogo service={connection.service} size={26} />
            </div>
            <div className="connectcard__body">
              <div className="connectcard__name">{SERVICE_META[connection.service].label}</div>
              <div className="muted connectcard__hint">
                {connection.connected
                  ? (connection.account?.displayName ?? 'Подключено')
                  : 'Вход на сайте сервиса — пароль остаётся у него'}
              </div>
              {connection.error && <div className="connectcard__error">{connection.error}</div>}
            </div>
            <button
              className={connection.connected ? 'pill pill--ghost pill--sm' : 'pill pill--sm'}
              disabled={busy !== null}
              onClick={() => void run(connection.service)}
            >
              {busy === connection.service
                ? 'Открываем вход…'
                : connection.connected
                  ? 'Переподключить'
                  : 'Подключить'}
            </button>
          </div>
        ))}
      </div>

      <button className="connect__skip muted" onClick={onSkip}>
        {anyConnected ? 'Перейти к музыке' : 'Пропустить пока'}
      </button>
    </div>
  )
}
