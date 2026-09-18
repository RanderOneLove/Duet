import { useState } from 'react'
import { SERVICE_META, type Connection, type ServiceId } from '@shared/domain'
import { ServiceLogo } from '../../shared/ServiceLogo'
import { Check } from '../../shared/Icons'

interface Props {
  connections: Connection[]
  onConnect: (id: ServiceId) => Promise<void>
  onSkip: () => void
}

/**
 * Первый экран приложения (вайрфрейм 1l).
 *
 * Главное здесь — снять опасение, а не собрать логины: вход идёт на настоящих
 * страницах сервисов внутри приложения, и об этом сказано прямо, до того как
 * человек нажмёт «Войти». Подключённый сервис не предлагает кнопку заново —
 * там галочка: список читается как состояние, а не как анкета.
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
      <div className="connect__kicker muted">ПОДКЛЮЧЕНИЕ · ПЕРВЫЙ ЗАПУСК</div>
      <h1 className="connect__title">
        Два сервиса —<br />
        один плеер
      </h1>
      <p className="muted connect__lead">
        Вход происходит на настоящих страницах VK и Яндекса внутри приложения. Логин и
        пароль Duet не видит — только сессию, которую выдал сервис.
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
                  ? `подключено · ${connection.account?.displayName ?? 'вы'}`
                  : connection.service === 'yandex'
                    ? 'токен хранится зашифрованным'
                    : 'сессия хранится в отдельном разделе'}
              </div>
              {connection.error && <div className="connectcard__error">{connection.error}</div>}
            </div>

            {connection.connected ? (
              <span className="connectcard__done" title="Подключено">
                <Check size={16} />
              </span>
            ) : (
              <button
                className="pill pill--sm"
                disabled={busy !== null}
                onClick={() => void run(connection.service)}
              >
                {busy === connection.service ? 'Открываем вход…' : 'Войти'}
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="muted connect__note">
        Можно начать с одного сервиса — второй добавится в настройках.
      </p>

      <button className="connect__skip muted" onClick={onSkip}>
        {anyConnected ? 'Перейти к музыке' : 'Пропустить пока'}
      </button>
    </div>
  )
}
