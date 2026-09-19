import { useEffect, useState } from 'react'
import type { WaveChoice } from '@shared/domain'
import type { WaveTuning } from '@shared/wave'
import { Gear } from '../../shared/Icons'
import { Popover } from './Popover'
import { Segmented } from './Segmented'

/**
 * Подкрутить волну: настроение, язык, подбор.
 *
 * Варианты приходят от станции, а не записаны здесь, поэтому кнопка сама знает,
 * настраивается ли выбранный сервис: у VK записать выбор некуда, и там её
 * просто нет. Показывать переключатель, который ничего не меняет, хуже, чем не
 * показывать ничего.
 */
export function WaveTuner({ service }: { service: WaveChoice }): JSX.Element | null {
  const [tuning, setTuning] = useState<WaveTuning | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let dropped = false
    void window.shell.waveTuning(service).then((value) => {
      if (!dropped) setTuning(value)
    })
    return () => {
      dropped = true
    }
  }, [service])

  if (!tuning || tuning.groups.length === 0) return null

  const pick = (key: string, value: string): void => {
    // Показываем выбор сразу, не дожидаясь станции: ответ приходит за полсекунды,
    // и всё это время переключатель иначе стоял бы на старом.
    setTuning({ ...tuning, values: { ...tuning.values, [key]: value } })
    setSaving(true)
    void window.shell.setWaveTuning(service, { [key]: value }).then((ok) => {
      setSaving(false)
      if (ok) return
      // Не приняли — возвращаем как было, иначе окно врёт про станцию.
      void window.shell.waveTuning(service).then(setTuning)
    })
  }

  return (
    <Popover
      icon={<Gear size={15} />}
      title="Настроить волну"
      align="down"
      portal
      panelClass="pop__panel--tuner"
    >
      {() => (
        <div className="tuner">
          {tuning.groups.map((group) => (
            <div key={group.key} className="tuner__row">
              <span className="muted tuner__label">{group.label}</span>
              <Segmented
                value={tuning.values[group.key] ?? group.choices[0]?.id ?? ''}
                disabled={saving}
                onChange={(value: string) => pick(group.key, value)}
                options={group.choices}
              />
            </div>
          ))}
          <p className="muted tuner__note">
            Станция перестроится со следующей порции треков — то, что уже в очереди,
            доиграет как есть.
          </p>
        </div>
      )}
    </Popover>
  )
}
