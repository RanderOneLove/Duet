import { useEffect, useState } from 'react'
import { IDLE_UPDATE, type UpdateState } from '@shared/updates'

/**
 * Состояние обновления, каким его знает главный процесс.
 *
 * Спрашивается один раз при появлении и дальше приходит само: проверка идёт по
 * расписанию, и окно может открыться посреди скачивания. Хук, а не проброшенное
 * сверху свойство, потому что состояние нужно в двух далёких друг от друга
 * местах — в титульной строке и в «О программе», — а между ними у него нет
 * общего владельца, которому бы оно ещё для чего-то пригодилось.
 */
export function useUpdate(): UpdateState {
  const [update, setUpdate] = useState<UpdateState>(IDLE_UPDATE)

  useEffect(() => {
    void window.shell.getUpdate().then(setUpdate)
    return window.shell.onUpdate(setUpdate)
  }, [])

  return update
}
