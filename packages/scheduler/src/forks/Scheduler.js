/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* eslint-disable no-var */

import {
  enableSchedulerDebugging,
  enableProfiling, //false
  enableIsInputPending,
  enableIsInputPendingContinuous,
  frameYieldMs,
  continuousYieldMs,
  maxYieldMs,
} from '../SchedulerFeatureFlags';

// 导入堆的方法
import {push, pop, peek} from '../SchedulerMinHeap';

// 五种调度优先度
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from '../SchedulerPriorities';
// 用于性能优化的行为标记方法
import {
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from '../SchedulerProfiling';

// 调度器的当前时间
let getCurrentTime;
/**
 * 用于性能分析
 * performance.now()方法返回一个精确到毫秒的DOMHighResTimeStamp
 */
const hasPerformanceNow =
  typeof performance === 'object' && typeof performance.now === 'function';

// 判断当前环境是否支持performance,如果不支持就是用Date
if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

// V8引擎下的最大int指
var maxSigned31BitInt = 1073741823;

/**
 * 定义不同场景的定时时间
 */

// 立即执行
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// 不同优先级时间
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
var NORMAL_PRIORITY_TIMEOUT = 5000;
var LOW_PRIORITY_TIMEOUT = 10000;
// 永不执行
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// 任务和计时器的队列，各自储存在堆上
/**
 * 根据任务的开始时间(startTime)排序,开始时间越早，说明会越早开始，开始时间小的排在前面
 * 任务初始是当前时间(currentTime),如果任务进入时传了延迟,那么开始时间则是currentTime+延迟时间
 */
var taskQueue = []; 
/**
 * 根据任务的过期时间(expirationTime排序),过期时间越早,说明任务越紧急,
 * 过期时间小的排在前面。过期时间根据任务优先级计算得出，优先级越高，过期时间越早
 */
var timerQueue = [];

// 递增的id计数器，用于维护插入顺序
var taskIdCounter = 1;

// 用于debug的暂定调度器flag
var isSchedulerPaused = false;

// 当前任务
var currentTask = null;
// 当前优先级别
var currentPriorityLevel = NormalPriority;

// 在进行工作时此flag置为真，以免多次重入工作
var isPerformingWork = false;

// host回调、过期调度flag
var isHostCallbackScheduled = false;
var isHostTimeoutScheduled = false;

// 获取本地对原生API的引用，以免被兜底代码包覆盖
const localSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : null;
const localSetImmediate =
  typeof setImmediate !== 'undefined' ? setImmediate : null; // IE and Node.js + jsdom

// 声明isInputPending
/**
 * isInputPending api 的目标是它现在将允许开发人员消除这种权衡。不再完全屈服于用户代理，
 * 并且在屈服后必须承担一个或多个事件循环的成本，长时间运行的脚本现在可以运行到完成，同时仍然保持响应。
 */
const isInputPending =
  typeof navigator !== 'undefined' &&
  navigator.scheduling !== undefined &&
  navigator.scheduling.isInputPending !== undefined
    ? navigator.scheduling.isInputPending.bind(navigator.scheduling)
    : null;

const continuousOptions = {includeContinuous: enableIsInputPendingContinuous};

/**
 * 用于检测timerQueue中的任务
 * 一旦timerQueue中的任务的开始时间达到,那么就推入taskQueue中
 */
function advanceTimers(currentTime) {
  // peek()获取timerQueue堆中第一个任务
  let timer = peek(timerQueue);
  // 知道timerQueue堆中任务被检查完毕
  while (timer !== null) {
    // 如果取得的第一个任务没有callback函数
    if (timer.callback === null) {
      // 就弹出堆中第一个任务
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // 如果第一个任务设置的时间到了就弹出
      pop(timerQueue);
      // 根据第一个任务的截止时间设置排序索引
      timer.sortIndex = timer.expirationTime;
      // 将第一个任务推送到任务队列中
      push(taskQueue, timer);
      // 如果开启了性能分析，将行为记录
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // 其余情况timer仍在等待队列中
      return;
    }
    // 取得timerQueue堆中的下一个任务
    timer = peek(timerQueue);
  }
}


function handleTimeout(currentTime) {
  // 将flag置否
  isHostTimeoutScheduled = false;
  // 重新处理计时器队列
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      // 任务队列非空的情况下，再次进入flushWork
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      // 如果当前还是没有可处理的任务，则继续定时下一个定时器的开始时间
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

function flushWork(hasTimeRemaining, initialTime) {
  // false
  if (enableProfiling) {
    // 性能分析记录行为
    markSchedulerUnsuspended(initialTime);
  }

  // 将回调函数调度flag置为否
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    // 把过时调度flag置为否
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  // 表示正在处理工作，以防重入
  isPerformingWork = true;
  // 保存当前优先度
  const previousPriorityLevel = currentPriorityLevel;
  try {
    if (enableProfiling) {
      try {
        // 如果允许性能分析，抓取可能的error，记录错误行为
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          markTaskErrored(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // 直接进行循环处理任务队列
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    // 循环处理完成之后，标记退出处理工作状态
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}


/**
 * workLoop作用:
 *  对任务进行循环执行,将有callback的任务的callback执行了,如果
 *  callback执行后还有后续任务,就将后续任务保存起来,执行下一个任务的callback
 *  反正就是即将所有人任务的callback执行完毕
 */
function workLoop(hasTimeRemaining, initialTime) {
  // 初始时间就是当前时间
  let currentTime = initialTime;
  // 将可以开始的任务从timeQueue堆转到taskQueue堆
  advanceTimers(currentTime);
  // 取出堆顶任务
  currentTask = peek(taskQueue);
  /**
   * 循环条件:
   *  进入循环，当前任务非空、调度器未被中止且不在debug模式
   */
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      // 任务过期时间大于当前时间 并且 (没有剩余事件 或者 需要返回host) 则退出
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // This currentTask hasn't expired, and we've reached the deadline.
      break;
    }
    // 获取当前任务的callback
    const callback = currentTask.callback;

    if (typeof callback === 'function') {
      // 清除当前任务身上的callback
      currentTask.callback = null;
      // 获取当前任务的优先级别
      currentPriorityLevel = currentTask.priorityLevel;
      // 确认任务未过期
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      // 性能分析
      if (enableProfiling) {
        markTaskRun(currentTask, currentTime);
      }
      // 执行回调函数，并将回调函数返回值保存,  callback需要接收的是boolean,因为didUserCallbackTimeout返回boolean
      const continuationCallback = callback(didUserCallbackTimeout);
      // 获取当前时间
      currentTime = getCurrentTime();
      /**
       * 这里判断执行完callback后返回的如果还是函数,
       * 就说明还有任务没有执行完毕
       */
      if (typeof continuationCallback === 'function') {
        // 保存callback执行后的后续任务
        currentTask.callback = continuationCallback;
        // 性能分析
        if (enableProfiling) {
          markTaskYield(currentTask, currentTime);
        }
      } else {
        if (enableProfiling) {
          markTaskCompleted(currentTask, currentTime);
          currentTask.isQueued = false;
        }
        // 确认当前任务和任务队列第一个任务一致
        if (currentTask === peek(taskQueue)) {
          // 完成任务，弹出
          pop(taskQueue);
        }
      }
      // 重新更新任务队列
      advanceTimers(currentTime);
    } else {
      // 如果这个任务没有callback,就弹出
      pop(taskQueue);
    }
    // 获取下一个任务,进行下一次循环
    currentTask = peek(taskQueue);
  }
  /**
   * 能走到这里,即使当前任务有值，说明由于过期等原因弹出，返回true
   */
  if (currentTask !== null) {
    return true;
  } else {
    // 当前任务队列已经全部处理完毕
    // 取得第一个timer
    const firstTimer = peek(timerQueue);
    // 定时下个定时器的开始时间
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    // 返回false
    return false;
  }
}

/**
 * 优先运行
 * 就是将当前调度器的优先度暂定,将传入的eventHandler执行后,再将调度器的优先度恢复
 */
function unstable_runWithPriority(priorityLevel, eventHandler) {
  // 确保priorityLevel是预设的优先度值
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }
  // 转移当前调度器的处理优先度
  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    // 执行事件处理方法
    return eventHandler();
  } finally {
    // 恢复当前调度器的处理优先度
    currentPriorityLevel = previousPriorityLevel;
  }
}

/**
 * next:
 *  将优先级降低后处理事件完毕后,恢复原有优先级
 */
function unstable_next(eventHandler) {
  var priorityLevel;
  // 将高优先级转为普通优先级
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      priorityLevel = NormalPriority;
      break;
    default:
      // 低于普通优先级的保持不变
      priorityLevel = currentPriorityLevel;
      break;
  }

  // 保存当前优先级
  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    // 处理事件
    return eventHandler();
  } finally {
    // 恢复优先级
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback(callback) {
  // 保存当前优先级
  var parentPriorityLevel = currentPriorityLevel;
  /**
   * 返回一个函数,这个函数保存着当前优先级,
   * 并使用apply改变callback执行后
   * 恢复优先级
   */
  return function() {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}


/**
 * 作用:
 *  根据传入的参数创建一个新任务.
 *  会在这个新任务上设置任务开始时间,定时消息,过期时间,?延迟任务
 */
function unstable_scheduleCallback(priorityLevel, callback, options) {
  var currentTime = getCurrentTime();

  // 任务开始时间
  var startTime;

  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    // 判断是否传入延迟时间
    if (typeof delay === 'number' && delay > 0) {
      //开始时间=当前时间+ 延迟
      startTime = currentTime + delay;
    } else {
      // 开始时间= 当前时间
      startTime = currentTime;
    }
  } else {
    // 开始时间= 当前时间
    startTime = currentTime;
  }

  // 设置定时信息
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  // 设置过期时间
  var expirationTime = startTime + timeout;

  var newTask = {
    /**
     * 任务id，在 react 中是一个全局变量，每次新增 task 会自增1
     */
    id: taskIdCounter++,
    // 回调
    callback,
    // 通过 Scheduler 和 React Lanes 优先级融合过的任务优先级
    priorityLevel,
    // 开始时间
    startTime,
    // 过期时间
    expirationTime,
    // 排序索引, 全等于过期时间. 保证过期时间越小, 越紧急的任务排在最前面
    sortIndex: -1,
  };
  if (enableProfiling) {
    newTask.isQueued = false;
  }


  if (startTime > currentTime) {
     // 延迟任务
    newTask.sortIndex = startTime;
    // 将任务推入计时器队列中
    push(timerQueue, newTask);
    // 如果计时队列中所有都是延迟任务，且新任务排序为第一个
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // 如果已经设置了一个定时
      if (isHostTimeoutScheduled) {
        // 取消
        cancelHostTimeout();
      } else {
        // 设置isHostTimeoutScheduled flag为真
        isHostTimeoutScheduled = true;
      }
      // 调度一个定时，在startTime - currenTime时间之后处理计时器队列
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    // 如果不是一个延迟任务，将新任务的排序索引设置为过期时间
    newTask.sortIndex = expirationTime;
    // 并推入任务队列
    push(taskQueue, newTask);
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // 调度一个hostcallback，如果当前正在处理工作，则等待下一次处理
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }
  // 返回新创的任务
  return newTask;
}


/**
 * 暂定执行:
 */
function unstable_pauseExecution() {
  // 暂停调度器
  isSchedulerPaused = true;
}

/**
 * 恢复执行
 */
function unstable_continueExecution() {
  // 恢复调度器
  isSchedulerPaused = false;
  // 如果当前不在处理工作，则请求开始flushWork
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}


/**
 * 获取堆顶任务
 */
function unstable_getFirstCallbackNode() {
  // 返回任务队列第一个任务
  return peek(taskQueue);
}

/**
 * 删除callback
 */
function unstable_cancelCallback(task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  /**
   * 将callback置为null,
   * 为什么不直接删除呢?
   * 因为task是个基于array的堆,不能直接从队列中删去
   */
  task.callback = null;
}


/**
 * 获取当前优先级
 */
function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel;
}

// 消息循环正在运行flag
let isMessageLoopRunning = false;
let scheduledHostCallback = null;
let taskTimeoutID = -1;

// Scheduler periodically yields in case there is other work on the main
// thread, like user events. By default, it yields multiple times per frame.
// It does not attempt to align with frame boundaries, since most tasks don't
// need to be frame aligned; for those that do, use requestAnimationFrame.
let frameInterval = frameYieldMs; //5  帧间隔
const continuousInputInterval = continuousYieldMs; //50  连续输入间隔
const maxInterval = maxYieldMs; //300 最大间隔
let startTime = -1;

let needsPaint = false;

function shouldYieldToHost() {
  // 获取当前时间距离开始时间多久了
  const timeElapsed = getCurrentTime() - startTime;
  // 判断时间流失是否小于5
  if (timeElapsed < frameInterval) {
    return false;
  }
  // enableIsInputPending:false
  if (enableIsInputPending) {
    // 如果当前有挂起的paint
    if (needsPaint) {
      return true;
    }
    // 如果时间流失小于50
    if (timeElapsed < continuousInputInterval) {
      // 判断当前浏览器支持isInputPending
      if (isInputPending !== null) {
        //使用isInputPending
        return isInputPending();
      }
      // 如果时间流失小于300
    } else if (timeElapsed < maxInterval) {
      // 判断当前浏览器支持isInputPending
      if (isInputPending !== null) {
        return isInputPending(continuousOptions);
      }
    } else {
      return true;
    }
  }

  return true;
}


/**
 * 判断isInputPending是否可用,如果不可用needsPaint无所谓了
 * 因为needsPaint只有在isInputPeding可用的情况下才有意义
 */
function requestPaint() {
  // 判断isInputPending是否可用
  if (
    enableIsInputPending &&
    navigator !== undefined &&
    navigator.scheduling !== undefined &&
    navigator.scheduling.isInputPending !== undefined
  ) {
    // 在isInputPending可用的情况下needsPaint才有意义，其他情况下，在每一帧结束后重绘
    needsPaint = true;
  }
}


/**
 * 强制帧加速
 */
function forceFrameRate(fps) {
  // fps范围为0~125
  if (fps < 0 || fps > 125) {
    // Using console['error'] to evade Babel and ESLint
    console['error'](
      'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
    );
    return;
  }
  // 根据fps调整等待frameInterval数量的最大值
  if (fps > 0) {
    frameInterval = Math.floor(1000 / fps);
  } else {
    // 重置frameInterval
    frameInterval = frameYieldMs;
  }
}

const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime();
    startTime = currentTime;
    // 剩余时间flag
    const hasTimeRemaining = true;

    // 如果一个调度器任务抛错，退出当前浏览器任务，以捕捉错误
    // 如果scheduledHostCallback出错，我们可以继续完成剩余的工作
    // 更多工作flag
    let hasMoreWork = true;
    try {
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime);
    } finally {
      if (hasMoreWork) {
         // 如果有更多工作，继续执行本方法
        schedulePerformWorkUntilDeadline();
      } else {
        // 将消息任务循环 flag置否
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    isMessageLoopRunning = false;
  }
  // 执行yield后会重绘，因此needsPaint置否
  needsPaint = false;
};


// node and ie Environment
let schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === 'function') {
  // Node.js and old IE.
  // There's a few reasons for why we prefer setImmediate.
  //
  // Unlike MessageChannel, it doesn't prevent a Node.js process from exiting.
  // (Even though this is a DOM fork of the Scheduler, you could get here
  // with a mix of Node.js 15+, which has a MessageChannel, and jsdom.)
  // https://github.com/facebook/react/issues/20756
  //
  // But also, it runs earlier which is the semantic we want.
  // If other browsers ever implement it, it's better to use it.
  // Although both of these would be inferior to native scheduling.
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== 'undefined') {
  // DOM and Worker environments.
  // We prefer MessageChannel because of the 4ms setTimeout clamping.
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null);
  };
} else {
  // We should only fallback here in non-browser environments.
  schedulePerformWorkUntilDeadline = () => {
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}

function requestHostCallback(callback) {
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}

// 在host上定时一个ms毫秒后的的回调函数
function requestHostTimeout(callback, ms) {
  taskTimeoutID = localSetTimeout(() => {
    callback(getCurrentTime());
  }, ms);
}

function cancelHostTimeout() {
  localClearTimeout(taskTimeoutID);
  taskTimeoutID = -1;
}

const unstable_requestPaint = requestPaint;

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};

export const unstable_Profiling = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
    }
  : null;
