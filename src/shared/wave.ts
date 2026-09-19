/**
 * Настройка волны — то, чем станцию можно подкрутить под себя.
 *
 * Варианты не зашиты в приложение, а приходят от сервиса: у станции свой набор
 * допустимых значений, и придумывать его за неё — верный способ однажды послать
 * то, чего она не принимает. Подписи наши, ключи и значения — её.
 */
export interface WaveChoiceOption {
  id: string
  label: string
}

export interface WaveTuningGroup {
  key: string
  label: string
  choices: WaveChoiceOption[]
}

export interface WaveTuning {
  /** Что стоит сейчас: ключ группы → выбранное значение. */
  values: Record<string, string>
  groups: WaveTuningGroup[]
}
