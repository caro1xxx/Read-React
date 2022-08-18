/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {SchedulerCallback} from './Scheduler';

import {
  DiscreteEventPriority,
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
} from './ReactEventPriorities.old';
import {ImmediatePriority, scheduleCallback} from './Scheduler';

let syncQueue: Array<SchedulerCallback> | null = null;
let includesLegacySyncCallbacks: boolean = false;
let isFlushingSyncQueue: boolean = false;

export function scheduleSyncCallback(callback: SchedulerCallback) {
  // Push this callback into an internal queue. We'll flush these either in
  // the next tick, or earlier if something calls `flushSyncCallbackQueue`.
  if (syncQueue === null) {
    syncQueue = [callback];
  } else {
    // Push onto existing queue. Don't need to schedule a callback because
    // we already scheduled one when we created the queue.
    // 入队
    syncQueue.push(callback);
  }
}

export function scheduleLegacySyncCallback(callback: SchedulerCallback) {
  includesLegacySyncCallbacks = true;
  scheduleSyncCallback(callback);
}

export function flushSyncCallbacksOnlyInLegacyMode() {
  // Only flushes the queue if there's a legacy sync callback scheduled.
  // TODO: There's only a single type of callback: performSyncOnWorkOnRoot. So
  // it might make more sense for the queue to be a list of roots instead of a
  // list of generic callbacks. Then we can have two: one for legacy roots, one
  // for concurrent roots. And this method would only flush the legacy ones.
  if (includesLegacySyncCallbacks) {
    flushSyncCallbacks();
  }
}

export function flushSyncCallbacks() {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // 防止重入
    isFlushingSyncQueue = true;
    let i = 0;
    // 获取当前更新优先级
    const previousUpdatePriority = getCurrentUpdatePriority();
    try {
      // 是否同步
      const isSync = true;
      // 获取同步队列
      const queue = syncQueue;
      //设置当前更新优先级为离散
      setCurrentUpdatePriority(DiscreteEventPriority);
      // 遍历同步队列
      for (; i < queue.length; i++) {
        let callback = queue[i];
        // 依次执行同步队列中所有callabck,知道为null后进行下一个任务
        do {
          callback = callback(isSync);
        } while (callback !== null);
      }
      // 重置
      syncQueue = null;
      includesLegacySyncCallbacks = false;
    } catch (error) {
      // 如果有错误抛出，就把剩余的回调留在队列中。
      if (syncQueue !== null) {
        syncQueue = syncQueue.slice(i + 1);
      }
      //在下一个tick冲洗
      // 这里的意思就是将flushSyncCallbacks这个任务以ImmediatePriority(立即执行的方式)放入调度器里,等待下一次执行
      scheduleCallback(ImmediatePriority, flushSyncCallbacks);
      throw error;
    } finally {
      // 恢复
      setCurrentUpdatePriority(previousUpdatePriority);
      isFlushingSyncQueue = false;
    }
  }
  return null;
}
