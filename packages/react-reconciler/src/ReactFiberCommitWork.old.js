/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {
  Instance,
  TextInstance,
  SuspenseInstance,
  Container,
  ChildSet,
  UpdatePayload,
} from './ReactFiberHostConfig';
import type {Fiber} from './ReactInternalTypes';
import type {FiberRoot} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane.old';
import type {SuspenseState} from './ReactFiberSuspenseComponent.old';
import type {UpdateQueue} from './ReactFiberClassUpdateQueue.old';
import type {FunctionComponentUpdateQueue} from './ReactFiberHooks.old';
import type {Wakeable} from 'shared/ReactTypes';
import type {
  OffscreenState,
  OffscreenInstance,
  OffscreenQueue,
} from './ReactFiberOffscreenComponent';
import type {HookFlags} from './ReactHookEffectTags';
import type {Cache} from './ReactFiberCacheComponent.old';
import type {RootState} from './ReactFiberRoot.old';
import type {Transition} from './ReactFiberTracingMarkerComponent.old';

import {
  enableCreateEventHandleAPI,
  enableProfilerTimer,
  enableProfilerCommitHooks,
  enableProfilerNestedUpdatePhase,
  enableSchedulingProfiler,
  enableSuspenseCallback,
  enableScopeAPI,
  enableStrictEffects,
  deletedTreeCleanUpLevel,
  enableUpdaterTracking,
  enableCache,
  enableTransitionTracing,
} from 'shared/ReactFeatureFlags';
import {
  FunctionComponent,
  ForwardRef,
  ClassComponent,
  HostRoot,
  HostComponent,
  HostText,
  HostPortal,
  Profiler,
  SuspenseComponent,
  DehydratedFragment,
  IncompleteClassComponent,
  MemoComponent,
  SimpleMemoComponent,
  SuspenseListComponent,
  ScopeComponent,
  OffscreenComponent,
  LegacyHiddenComponent,
  CacheComponent,
  TracingMarkerComponent,
} from './ReactWorkTags';
import {detachDeletedInstance} from './ReactFiberHostConfig';
import {
  NoFlags,
  ContentReset,
  Placement,
  ChildDeletion,
  Snapshot,
  Update,
  Callback,
  Ref,
  Hydrating,
  Passive,
  BeforeMutationMask,
  MutationMask,
  LayoutMask,
  PassiveMask,
  Visibility,
} from './ReactFiberFlags';
import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {
  resetCurrentFiber as resetCurrentDebugFiberInDEV,
  setCurrentFiber as setCurrentDebugFiberInDEV,
  getCurrentFiber as getCurrentDebugFiberInDEV,
} from './ReactCurrentFiber';
import {resolveDefaultProps} from './ReactFiberLazyComponent.old';
import {
  isCurrentUpdateNested,
  getCommitTime,
  recordLayoutEffectDuration,
  startLayoutEffectTimer,
  recordPassiveEffectDuration,
  startPassiveEffectTimer,
} from './ReactProfilerTimer.old';
import {ConcurrentMode, NoMode, ProfileMode} from './ReactTypeOfMode';
import {
  deferHiddenCallbacks,
  commitHiddenCallbacks,
  commitCallbacks,
} from './ReactFiberClassUpdateQueue.old';
import {
  getPublicInstance,
  supportsMutation,
  supportsPersistence,
  supportsHydration,
  commitMount,
  commitUpdate,
  resetTextContent,
  commitTextUpdate,
  appendChild,
  appendChildToContainer,
  insertBefore,
  insertInContainerBefore,
  removeChild,
  removeChildFromContainer,
  clearSuspenseBoundary,
  clearSuspenseBoundaryFromContainer,
  replaceContainerChildren,
  createContainerChildSet,
  hideInstance,
  hideTextInstance,
  unhideInstance,
  unhideTextInstance,
  commitHydratedContainer,
  commitHydratedSuspenseInstance,
  clearContainer,
  prepareScopeUpdate,
  prepareForCommit,
  beforeActiveInstanceBlur,
} from './ReactFiberHostConfig';
import {
  captureCommitPhaseError,
  resolveRetryWakeable,
  markCommitTimeOfFallback,
  enqueuePendingPassiveProfilerEffect,
  restorePendingUpdaters,
  addTransitionStartCallbackToPendingTransition,
  addTransitionProgressCallbackToPendingTransition,
  addTransitionCompleteCallbackToPendingTransition,
  addMarkerProgressCallbackToPendingTransition,
  addMarkerCompleteCallbackToPendingTransition,
  setIsRunningInsertionEffect,
} from './ReactFiberWorkLoop.old';
import {
  NoFlags as NoHookEffect,
  HasEffect as HookHasEffect,
  Layout as HookLayout,
  Insertion as HookInsertion,
  Passive as HookPassive,
} from './ReactHookEffectTags';
import {didWarnAboutReassigningProps} from './ReactFiberBeginWork.old';
import {doesFiberContain} from './ReactFiberTreeReflection';
import {invokeGuardedCallback, clearCaughtError} from 'shared/ReactErrorUtils';
import {
  isDevToolsPresent,
  markComponentPassiveEffectMountStarted,
  markComponentPassiveEffectMountStopped,
  markComponentPassiveEffectUnmountStarted,
  markComponentPassiveEffectUnmountStopped,
  markComponentLayoutEffectMountStarted,
  markComponentLayoutEffectMountStopped,
  markComponentLayoutEffectUnmountStarted,
  markComponentLayoutEffectUnmountStopped,
  onCommitUnmount,
} from './ReactFiberDevToolsHook.old';
import {releaseCache, retainCache} from './ReactFiberCacheComponent.old';
import {clearTransitionsForLanes} from './ReactFiberLane.old';

let didWarnAboutUndefinedSnapshotBeforeUpdate: Set<mixed> | null = null;
if (__DEV__) {
  didWarnAboutUndefinedSnapshotBeforeUpdate = new Set();
}

// Used during the commit phase to track the state of the Offscreen component stack.
// Allows us to avoid traversing the return path to find the nearest Offscreen ancestor.
let offscreenSubtreeIsHidden: boolean = false;
let offscreenSubtreeWasHidden: boolean = false;

const PossiblyWeakSet = typeof WeakSet === 'function' ? WeakSet : Set;

let nextEffect: Fiber | null = null;

// Used for Profiling builds to track updaters.
let inProgressLanes: Lanes | null = null;
let inProgressRoot: FiberRoot | null = null;

export function reportUncaughtErrorInDEV(error: mixed) {
  // Wrapping each small part of the commit phase into a guarded
  // callback is a bit too slow (https://github.com/facebook/react/pull/21666).
  // But we rely on it to surface errors to DEV tools like overlays
  // (https://github.com/facebook/react/issues/21712).
  // As a compromise, rethrow only caught errors in a guard.
  if (__DEV__) {
    invokeGuardedCallback(null, () => {
      throw error;
    });
    clearCaughtError();
  }
}

const callComponentWillUnmountWithTimer = function(current, instance) {
  instance.props = current.memoizedProps;
  instance.state = current.memoizedState;
  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    current.mode & ProfileMode
  ) {
    try {
      startLayoutEffectTimer();
      instance.componentWillUnmount();
    } finally {
      recordLayoutEffectDuration(current);
    }
  } else {
    instance.componentWillUnmount();
  }
};

// Capture errors so they don't interrupt unmounting.
function safelyCallComponentWillUnmount(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  instance: any,
) {
  try {
    callComponentWillUnmountWithTimer(current, instance);
  } catch (error) {
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

// 捕获错误，以便它们不会中断安装。
function safelyAttachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
  try {
    commitAttachRef(current);
  } catch (error) {
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

function safelyDetachRef(current: Fiber, nearestMountedAncestor: Fiber | null) {
  // 获取ref
  const ref = current.ref;
  // ref存在
  if (ref !== null) {
    // 如果ref是个fn
    if (typeof ref === 'function') {
      let retVal;
      try {
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          current.mode & ProfileMode
        ) {
          try {
            // 启动布局效果计数器
            startLayoutEffectTimer();
            // 将ref指向空
            retVal = ref(null);
          } finally {
            // 记录布局持续时间
            recordLayoutEffectDuration(current);
          }
        } else {
          // 将ref指向空
          retVal = ref(null);
        }
      } catch (error) {
        captureCommitPhaseError(current, nearestMountedAncestor, error);
      }
      if (__DEV__) {
        if (typeof retVal === 'function') {
          console.error(
            'Unexpected return value from a callback ref in %s. ' +
              'A callback ref should not return a function.',
            getComponentNameFromFiber(current),
          );
        }
      }
    } else {
      // ref置为null
      ref.current = null;
    }
  }
}

function safelyCallDestroy(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  destroy: () => void,
) {
  try {
    // 执行
    destroy();
  } catch (error) {
    // 错误处理
    captureCommitPhaseError(current, nearestMountedAncestor, error);
  }
}

let focusedInstanceHandle: null | Fiber = null;
let shouldFireAfterActiveInstanceBlur: boolean = false;

export function commitBeforeMutationEffects(
  root: FiberRoot,
  firstChild: Fiber,
) {
  // prepareForCommit() 返回null 并且初始化全局变量
  focusedInstanceHandle = prepareForCommit(root.containerInfo);

  nextEffect = firstChild;
  // 开始处理副作用
  commitBeforeMutationEffects_begin();

  // 不再跟踪fiber节点
  const shouldFire = shouldFireAfterActiveInstanceBlur;
  shouldFireAfterActiveInstanceBlur = false;
  focusedInstanceHandle = null;

  return shouldFire;
}

function commitBeforeMutationEffects_begin() {
  // 从上往下遍历，找到最底部并且有标记了 before mutation 的 fiber 节点
  while (nextEffect !== null) {
    const fiber = nextEffect;

    //这个阶段只用于beforeActiveInstanceBlur.如果它是关闭的，就跳过
    if (enableCreateEventHandleAPI) {
      // 如果节点标记了deletions,将会被删除,并且
      // 调用commitBeforeMutationEffectsDeletion创建 blur 事件并进行派发
      const deletions = fiber.deletions;
      if (deletions !== null) {
        for (let i = 0; i < deletions.length; i++) {
          const deletion = deletions[i];
          commitBeforeMutationEffectsDeletion(deletion);
        }
      }
    }

    const child = fiber.child;
    // 判断节点是否标记了 before mutation
    if (
      // 如果子树有包含BeforeMutationMask标记的节点
      (fiber.subtreeFlags & BeforeMutationMask) !== NoFlags &&
      child !== null// child !== null判断是否是最底部节点
    ) {
      // 向下继续获取
      child.return = fiber;
      nextEffect = child;
    } else {
      // 如果执行到这里,说明这个节点是标记了before mutation的`最底部节点`
      // 执行complete,完成更新fiber节点的 props 和 state
      commitBeforeMutationEffects_complete();
    }
  }
}

function commitBeforeMutationEffects_complete() {
  // 从下至上,归并
  while (nextEffect !== null) {
    const fiber = nextEffect;
    setCurrentDebugFiberInDEV(fiber);
    try {
      // 依次执行
      commitBeforeMutationEffectsOnFiber(fiber);
    } catch (error) {
      captureCommitPhaseError(fiber, fiber.return, error);
    }
    resetCurrentDebugFiberInDEV();

    // 判断是否存在兄弟节点
    const sibling = fiber.sibling;
    if (sibling !== null) {
      sibling.return = fiber.return;
      nextEffect = sibling;
      return;
    }

    // 向上获取
    nextEffect = fiber.return;
  }
}

function commitBeforeMutationEffectsOnFiber(finishedWork: Fiber) {
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  if (enableCreateEventHandleAPI) {
    if (!shouldFireAfterActiveInstanceBlur && focusedInstanceHandle !== null) {
      // Check to see if the focused element was inside of a hidden (Suspense) subtree.
      // TODO: Move this out of the hot path using a dedicated effect tag.
      if (
        finishedWork.tag === SuspenseComponent &&
        isSuspenseBoundaryBeingHidden(current, finishedWork) &&
        doesFiberContain(finishedWork, focusedInstanceHandle)
      ) {
        shouldFireAfterActiveInstanceBlur = true;
        beforeActiveInstanceBlur(finishedWork);
      }
    }
  }

  if ((flags & Snapshot) !== NoFlags) {
    setCurrentDebugFiberInDEV(finishedWork);

    // 根据 tag 的不同进入不同的处理逻辑
    switch (finishedWork.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        break;
      }
      case ClassComponent: {
        // current !== null 说明是update
        if (current !== null) {
          // 获取上次的props
          const prevProps = current.memoizedProps;
          // 获取上次的state
          const prevState = current.memoizedState;
          // 获取真实节点
          const instance = finishedWork.stateNode;
          // We could update instance props and state here,
          // but instead we rely on them being set during last render.
          // TODO: revisit this when we implement resuming.
          if (__DEV__) {
            if (
              finishedWork.type === finishedWork.elementType &&
              !didWarnAboutReassigningProps
            ) {
              if (instance.props !== finishedWork.memoizedProps) {
                console.error(
                  'Expected %s props to match memoized props before ' +
                    'getSnapshotBeforeUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.props`. ' +
                    'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
              if (instance.state !== finishedWork.memoizedState) {
                console.error(
                  'Expected %s state to match memoized state before ' +
                    'getSnapshotBeforeUpdate. ' +
                    'This might either be because of a bug in React, or because ' +
                    'a component reassigns its own `this.state`. ' +
                    'Please file an issue.',
                  getComponentNameFromFiber(finishedWork) || 'instance',
                );
              }
            }
          }

          /*
            getSnapShotBeforeUpdate 生命周期函数，它是在 commit 阶段内的
            before mutation 阶段调用的，由于 commit 阶段是同步执行的，所以不会遇到多次调用的情况
          */

          // getSnapshotBeforeUpdate()生命周期方法
          const snapshot = instance.getSnapshotBeforeUpdate(
            finishedWork.elementType === finishedWork.type
              ? prevProps
              : resolveDefaultProps(finishedWork.type, prevProps),
            prevState,
          );
          if (__DEV__) {
            const didWarnSet = ((didWarnAboutUndefinedSnapshotBeforeUpdate: any): Set<mixed>);
            if (snapshot === undefined && !didWarnSet.has(finishedWork.type)) {
              didWarnSet.add(finishedWork.type);
              console.error(
                '%s.getSnapshotBeforeUpdate(): A snapshot value (or null) ' +
                  'must be returned. You have returned undefined.',
                getComponentNameFromFiber(finishedWork),
              );
            }
          }
          // 将生成的snapshot保存到真实节点的__reactInternalSnapshotBeforeUpdate上
          // 以供DidUpdate 生命周期使用
          instance.__reactInternalSnapshotBeforeUpdate = snapshot;
        }
        break;
      }
      case HostRoot: {
        if (supportsMutation) {
          const root = finishedWork.stateNode;
          clearContainer(root.containerInfo);
        }
        break;
      }
      case HostComponent:
      case HostText:
      case HostPortal:
      case IncompleteClassComponent:
        // Nothing to do for these component types
        break;
      default: {
        throw new Error(
          'This unit of work tag should not have side-effects. This error is ' +
            'likely caused by a bug in React. Please file an issue.',
        );
      }
    }

    resetCurrentDebugFiberInDEV();
  }
}

function commitBeforeMutationEffectsDeletion(deletion: Fiber) {
  if (enableCreateEventHandleAPI) {
    // TODO (effects) It would be nice to avoid calling doesFiberContain()
    // Maybe we can repurpose one of the subtreeFlags positions for this instead?
    // Use it to store which part of the tree the focused instance is in?
    // This assumes we can safely determine that instance during the "render" phase.
    if (doesFiberContain(deletion, ((focusedInstanceHandle: any): Fiber))) {
      shouldFireAfterActiveInstanceBlur = true;
      beforeActiveInstanceBlur(deletion);
    }
  }
}

// 作用:循环执行fiber上的effects

// 如果使用了useEffect/useLayoutEffect等，
// 会创建effect，并形成链表挂载到fiber.updateQueue.effects.lastEffect上)
function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next;
    // 找到第一个 effect
    let effect = firstEffect;
    do {
      // 如果 tag 包含 flags
      if ((effect.tag & flags) === flags) {
        // Unmount
        // 获取destroy方法
        const destroy = effect.destroy;
        // 删除destroy方法
        effect.destroy = undefined;
        // 判断destroy是否存在
        if (destroy !== undefined) {
          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectUnmountStarted(finishedWork);
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectUnmountStarted(finishedWork);
            }
          }

          if (__DEV__) {
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(true);
            }
          }

          // 安全的执行Destroy方法
          safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy);

          if (__DEV__) {
            if ((flags & HookInsertion) !== NoHookEffect) {
              setIsRunningInsertionEffect(false);
            }
          }

          if (enableSchedulingProfiler) {
            if ((flags & HookPassive) !== NoHookEffect) {
              markComponentPassiveEffectUnmountStopped();
            } else if ((flags & HookLayout) !== NoHookEffect) {
              markComponentLayoutEffectUnmountStopped();
            }
          }
        }
      }
      // 获取effect链中的下一个effect
      effect = effect.next;
      // 直到effect链执行完毕
    } while (effect !== firstEffect);
  }
}

function commitHookEffectListMount(flags: HookFlags, finishedWork: Fiber) {
  // 获取队列
  const updateQueue: FunctionComponentUpdateQueue | null = (finishedWork.updateQueue: any);
  // 获取最后一个effect
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null;
  if (lastEffect !== null) {
    // lastEffect.next就是在获取第一个effect
    const firstEffect = lastEffect.next;
    let effect = firstEffect;
    do {
      if ((effect.tag & flags) === flags) {
        if (enableSchedulingProfiler) {
          if ((flags & HookPassive) !== NoHookEffect) {
            markComponentPassiveEffectMountStarted(finishedWork);
          } else if ((flags & HookLayout) !== NoHookEffect) {
            markComponentLayoutEffectMountStarted(finishedWork);
          }
        }

        // Mount
        // !!!!获取creat()
        const create = effect.create;
        if (__DEV__) {
          if ((flags & HookInsertion) !== NoHookEffect) {
            setIsRunningInsertionEffect(true);
          }
        }
        // 将effect的destroy置为create方法的执行结果
        effect.destroy = create();
        if (__DEV__) {
          if ((flags & HookInsertion) !== NoHookEffect) {
            setIsRunningInsertionEffect(false);
          }
        }

        if (enableSchedulingProfiler) {
          if ((flags & HookPassive) !== NoHookEffect) {
            markComponentPassiveEffectMountStopped();
          } else if ((flags & HookLayout) !== NoHookEffect) {
            markComponentLayoutEffectMountStopped();
          }
        }

        if (__DEV__) {
          const destroy = effect.destroy;
          if (destroy !== undefined && typeof destroy !== 'function') {
            let hookName;
            if ((effect.tag & HookLayout) !== NoFlags) {
              hookName = 'useLayoutEffect';
            } else if ((effect.tag & HookInsertion) !== NoFlags) {
              hookName = 'useInsertionEffect';
            } else {
              hookName = 'useEffect';
            }
            let addendum;
            if (destroy === null) {
              addendum =
                ' You returned null. If your effect does not require clean ' +
                'up, return undefined (or nothing).';
            } else if (typeof destroy.then === 'function') {
              addendum =
                '\n\nIt looks like you wrote ' +
                hookName +
                '(async () => ...) or returned a Promise. ' +
                'Instead, write the async function inside your effect ' +
                'and call it immediately:\n\n' +
                hookName +
                '(() => {\n' +
                '  async function fetchData() {\n' +
                '    // You can await here\n' +
                '    const response = await MyAPI.getData(someId);\n' +
                '    // ...\n' +
                '  }\n' +
                '  fetchData();\n' +
                `}, [someId]); // Or [] if effect doesn't need props or state\n\n` +
                'Learn more about data fetching with Hooks: https://reactjs.org/link/hooks-data-fetching';
            } else {
              addendum = ' You returned: ' + destroy;
            }
            console.error(
              '%s must not return anything besides a function, ' +
                'which is used for clean-up.%s',
              hookName,
              addendum,
            );
          }
        }
      }
      // 获取下一个effect
      effect = effect.next;
    } while (effect !== firstEffect);
  }
}

export function commitPassiveEffectDurations(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
): void {
  if (enableProfilerTimer && enableProfilerCommitHooks) {
    // Only Profilers with work in their subtree will have an Update effect scheduled.
    if ((finishedWork.flags & Update) !== NoFlags) {
      switch (finishedWork.tag) {
        case Profiler: {
          const {passiveEffectDuration} = finishedWork.stateNode;
          const {id, onPostCommit} = finishedWork.memoizedProps;

          // This value will still reflect the previous commit phase.
          // It does not get reset until the start of the next commit phase.
          const commitTime = getCommitTime();

          let phase = finishedWork.alternate === null ? 'mount' : 'update';
          if (enableProfilerNestedUpdatePhase) {
            if (isCurrentUpdateNested()) {
              phase = 'nested-update';
            }
          }

          if (typeof onPostCommit === 'function') {
            onPostCommit(id, phase, passiveEffectDuration, commitTime);
          }

          // Bubble times to the next nearest ancestor Profiler.
          // After we process that Profiler, we'll bubble further up.
          let parentFiber = finishedWork.return;
          outer: while (parentFiber !== null) {
            switch (parentFiber.tag) {
              case HostRoot:
                const root = parentFiber.stateNode;
                root.passiveEffectDuration += passiveEffectDuration;
                break outer;
              case Profiler:
                const parentStateNode = parentFiber.stateNode;
                parentStateNode.passiveEffectDuration += passiveEffectDuration;
                break outer;
            }
            parentFiber = parentFiber.return;
          }
          break;
        }
        default:
          break;
      }
    }
  }
}

function commitHookLayoutEffects(finishedWork: Fiber, hookFlags: HookFlags) {
  // At this point layout effects have already been destroyed (during mutation phase).
  // This is done to prevent sibling component effects from interfering with each other,
  // e.g. a destroy function in one component should never override a ref set
  // by a create function in another component during the same commit.
  if (
    enableProfilerTimer &&
    enableProfilerCommitHooks &&
    finishedWork.mode & ProfileMode
  ) {
    try {
      startLayoutEffectTimer();
      // 获取effects中的每一个effect并执行create方法
      commitHookEffectListMount(hookFlags, finishedWork);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
    recordLayoutEffectDuration(finishedWork);
  } else {
    try {
      commitHookEffectListMount(hookFlags, finishedWork);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

function commitClassLayoutLifecycles(
  finishedWork: Fiber,
  current: Fiber | null,
) {
  const instance = finishedWork.stateNode;
  // 如果current == nul 说明是挂载
  if (current === null) {
    // We could update instance props and state here,
    // but instead we rely on them being set during last render.
    // TODO: revisit this when we implement resuming.
    if (__DEV__) {
      if (
        finishedWork.type === finishedWork.elementType &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'componentDidMount. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'componentDidMount. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    if (
      enableProfilerTimer &&
      enableProfilerCommitHooks &&
      finishedWork.mode & ProfileMode
    ) {
      try {
        startLayoutEffectTimer();
        // 执行生命周期DidMount();
        instance.componentDidMount();
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
      recordLayoutEffectDuration(finishedWork);
    } else {
      try {
        // 执行生命周期DidMount();
        instance.componentDidMount();
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  // 反之就是更新
  } else {
    const prevProps =
      finishedWork.elementType === finishedWork.type
        ? current.memoizedProps
        : resolveDefaultProps(finishedWork.type, current.memoizedProps);
    const prevState = current.memoizedState;
    // We could update instance props and state here,
    // but instead we rely on them being set during last render.
    // TODO: revisit this when we implement resuming.
    if (__DEV__) {
      if (
        finishedWork.type === finishedWork.elementType &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'componentDidUpdate. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'componentDidUpdate. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    if (
      enableProfilerTimer &&
      enableProfilerCommitHooks &&
      finishedWork.mode & ProfileMode
    ) {
      try {
        startLayoutEffectTimer();
        instance.componentDidUpdate(
          prevProps,
          prevState,
          instance.__reactInternalSnapshotBeforeUpdate,
        );
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
      recordLayoutEffectDuration(finishedWork);
    } else {
      try {
        // 执行生命周期DidUpdate()
        instance.componentDidUpdate(
          prevProps,
          prevState,
          instance.__reactInternalSnapshotBeforeUpdate,
        );
      } catch (error) {
        captureCommitPhaseError(finishedWork, finishedWork.return, error);
      }
    }
  }
}

function commitClassCallbacks(finishedWork: Fiber) {
  // TODO: I think this is now always non-null by the time it reaches the
  // commit phase. Consider removing the type check.
  const updateQueue: UpdateQueue<*> | null = (finishedWork.updateQueue: any);
  if (updateQueue !== null) {
    const instance = finishedWork.stateNode;
    if (__DEV__) {
      if (
        finishedWork.type === finishedWork.elementType &&
        !didWarnAboutReassigningProps
      ) {
        if (instance.props !== finishedWork.memoizedProps) {
          console.error(
            'Expected %s props to match memoized props before ' +
              'processing the update queue. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.props`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
        if (instance.state !== finishedWork.memoizedState) {
          console.error(
            'Expected %s state to match memoized state before ' +
              'processing the update queue. ' +
              'This might either be because of a bug in React, or because ' +
              'a component reassigns its own `this.state`. ' +
              'Please file an issue.',
            getComponentNameFromFiber(finishedWork) || 'instance',
          );
        }
      }
    }
    // We could update instance props and state here,
    // but instead we rely on them being set during last render.
    // TODO: revisit this when we implement resuming.
    try {
      commitCallbacks(updateQueue, instance);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

function commitHostComponentMount(finishedWork: Fiber) {
  const type = finishedWork.type;
  const props = finishedWork.memoizedProps;
  const instance: Instance = finishedWork.stateNode;
  try {
    // 提交挂载
    // 内部判断是否属于 button/input/select/textarea/中的type,
    // 如果是的话就执行focus()聚焦
    commitMount(instance, type, props, finishedWork);
  } catch (error) {
    captureCommitPhaseError(finishedWork, finishedWork.return, error);
  }
}

function commitProfilerUpdate(finishedWork: Fiber, current: Fiber | null) {
  if (enableProfilerTimer) {
    try {
      const {onCommit, onRender} = finishedWork.memoizedProps;
      const {effectDuration} = finishedWork.stateNode;

      const commitTime = getCommitTime();

      let phase = current === null ? 'mount' : 'update';
      if (enableProfilerNestedUpdatePhase) {
        if (isCurrentUpdateNested()) {
          phase = 'nested-update';
        }
      }

      if (typeof onRender === 'function') {
        onRender(
          finishedWork.memoizedProps.id,
          phase,
          finishedWork.actualDuration,
          finishedWork.treeBaseDuration,
          finishedWork.actualStartTime,
          commitTime,
        );
      }

      if (enableProfilerCommitHooks) {
        if (typeof onCommit === 'function') {
          onCommit(
            finishedWork.memoizedProps.id,
            phase,
            effectDuration,
            commitTime,
          );
        }

        // Schedule a passive effect for this Profiler to call onPostCommit hooks.
        // This effect should be scheduled even if there is no onPostCommit callback for this Profiler,
        // because the effect is also where times bubble to parent Profilers.
        enqueuePendingPassiveProfilerEffect(finishedWork);

        // Propagate layout effect durations to the next nearest Profiler ancestor.
        // Do not reset these values until the next render so DevTools has a chance to read them first.
        let parentFiber = finishedWork.return;
        outer: while (parentFiber !== null) {
          switch (parentFiber.tag) {
            case HostRoot:
              const root = parentFiber.stateNode;
              root.effectDuration += effectDuration;
              break outer;
            case Profiler:
              const parentStateNode = parentFiber.stateNode;
              parentStateNode.effectDuration += effectDuration;
              break outer;
          }
          parentFiber = parentFiber.return;
        }
      }
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
  }
}

function commitLayoutEffectOnFiber(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedLanes: Lanes,
): void {

  // 在更新这个函数时，也要更新reappearLayoutEffects，它的作用是
  // 把不在屏幕上显示的那颗树 从隐藏 => 可见时

  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // 递归的获取子节点,在将这些子节点调用commitLayoutEffectOnFiber
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        // 如果更新,执行commitHookLayoutEffects
        commitHookLayoutEffects(finishedWork, HookLayout | HookHasEffect);
      }
      break;
    }
    // 类组件的情况
    case ClassComponent: {
      // 递归的获取子节点,在将这些子节点调用commitLayoutEffectOnFiber
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        // 内部就是判断是否是更新或者挂载,从而执行对应的hook
        commitClassLayoutLifecycles(finishedWork, current);
      }

      // 判断是否有callback
      if (flags & Callback) {
        // 执行callback
        commitClassCallbacks(finishedWork);
      }

      if (flags & Ref) {
        // 作用:获取ref绑定的节点实例,如果ref是个函数那么指定 ref 的引用,否则仅将ref指向节点实例
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    // 顶部节点情况
    case HostRoot: {
      // 递归的获取子节点,在将这些子节点调用commitLayoutEffectOnFiber
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      /*
        判断callback,如果存在,那么从队列中获取执行
      */
      if (flags & Callback) {
        // TODO: I think this is now always non-null by the time it reaches the
        // commit phase. Consider removing the type check.
        const updateQueue: UpdateQueue<
          *,
        > | null = (finishedWork.updateQueue: any);
        if (updateQueue !== null) {
          let instance = null;
          if (finishedWork.child !== null) {
            switch (finishedWork.child.tag) {
              case HostComponent:
                instance = getPublicInstance(finishedWork.child.stateNode);
                break;
              case ClassComponent:
                instance = finishedWork.child.stateNode;
                break;
            }
          }
          try {
            commitCallbacks(updateQueue, instance);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      break;
    }
    // 顶部组件情况
    case HostComponent: {
      // 递归的获取子节点,在将这些子节点调用commitLayoutEffectOnFiber
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );

      // Renderers may schedule work to be done after host components are mounted
      // (eg DOM renderer may schedule auto-focus for inputs and form controls).
      // These effects should only be committed when components are first mounted,
      // aka when there is no current/alternate.
      if (current === null && flags & Update) {
        // 判断是否属于输入类型的组件,如果是就focus()聚焦
        commitHostComponentMount(finishedWork);
      }

      // 执行ref
      if (flags & Ref) {
        safelyAttachRef(finishedWork, finishedWork.return);
      }
      break;
    }
    // Profiler
    case Profiler: {
      // 递归的获取子节点
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      // TODO: Should this fire inside an offscreen tree? Or should it wait to
      // fire when the tree becomes visible again.
      if (flags & Update) {
        commitProfilerUpdate(finishedWork, current);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      if (flags & Update) {
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case OffscreenComponent: {
      const isModernRoot = (finishedWork.mode & ConcurrentMode) !== NoMode;
      if (isModernRoot) {
        const isHidden = finishedWork.memoizedState !== null;
        const newOffscreenSubtreeIsHidden =
          isHidden || offscreenSubtreeIsHidden;
        if (newOffscreenSubtreeIsHidden) {
          // The Offscreen tree is hidden. Skip over its layout effects.
        } else {
          // The Offscreen tree is visible.

          const wasHidden = current !== null && current.memoizedState !== null;
          const newOffscreenSubtreeWasHidden =
            wasHidden || offscreenSubtreeWasHidden;
          const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
          const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
          offscreenSubtreeIsHidden = newOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = newOffscreenSubtreeWasHidden;

          if (offscreenSubtreeWasHidden && !prevOffscreenSubtreeWasHidden) {
            // This is the root of a reappearing boundary. As we continue
            // traversing the layout effects, we must also re-mount layout
            // effects that were unmounted when the Offscreen subtree was
            // hidden. So this is a superset of the normal commitLayoutEffects.
            const includeWorkInProgressEffects =
              (finishedWork.subtreeFlags & LayoutMask) !== NoFlags;
            recursivelyTraverseReappearLayoutEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
              includeWorkInProgressEffects,
            );
          } else {
            recursivelyTraverseLayoutEffects(
              finishedRoot,
              finishedWork,
              committedLanes,
            );
          }
          offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
          offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        }
      } else {
        recursivelyTraverseLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
        );
      }
      break;
    }
    default: {
      recursivelyTraverseLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
      );
      break;
    }
  }
}

function commitTransitionProgress(offscreenFiber: Fiber) {
  if (enableTransitionTracing) {
    // This function adds suspense boundaries to the root
    // or tracing marker's pendingBoundaries map.
    // When a suspense boundary goes from a resolved to a fallback
    // state we add the boundary to the map, and when it goes from
    // a fallback to a resolved state, we remove the boundary from
    // the map.

    // We use stateNode on the Offscreen component as a stable object
    // that doesnt change from render to render. This way we can
    // distinguish between different Offscreen instances (vs. the same
    // Offscreen instance with different fibers)
    const offscreenInstance: OffscreenInstance = offscreenFiber.stateNode;

    let prevState: SuspenseState | null = null;
    const previousFiber = offscreenFiber.alternate;
    if (previousFiber !== null && previousFiber.memoizedState !== null) {
      prevState = previousFiber.memoizedState;
    }
    const nextState: SuspenseState | null = offscreenFiber.memoizedState;

    const wasHidden = prevState !== null;
    const isHidden = nextState !== null;

    const pendingMarkers = offscreenInstance.pendingMarkers;
    // If there is a name on the suspense boundary, store that in
    // the pending boundaries.
    let name = null;
    const parent = offscreenFiber.return;
    if (
      parent !== null &&
      parent.tag === SuspenseComponent &&
      parent.memoizedProps.unstable_name
    ) {
      name = parent.memoizedProps.unstable_name;
    }

    if (!wasHidden && isHidden) {
      // The suspense boundaries was just hidden. Add the boundary
      // to the pending boundary set if it's there
      if (pendingMarkers !== null) {
        pendingMarkers.forEach(markerInstance => {
          const pendingBoundaries = markerInstance.pendingBoundaries;
          const transitions = markerInstance.transitions;
          if (
            pendingBoundaries !== null &&
            !pendingBoundaries.has(offscreenInstance)
          ) {
            pendingBoundaries.set(offscreenInstance, {
              name,
            });
            if (transitions !== null) {
              if (markerInstance.name) {
                addMarkerProgressCallbackToPendingTransition(
                  markerInstance.name,
                  transitions,
                  pendingBoundaries,
                );
              } else {
                transitions.forEach(transition => {
                  addTransitionProgressCallbackToPendingTransition(
                    transition,
                    pendingBoundaries,
                  );
                });
              }
            }
          }
        });
      }
    } else if (wasHidden && !isHidden) {
      // The suspense boundary went from hidden to visible. Remove
      // the boundary from the pending suspense boundaries set
      // if it's there
      if (pendingMarkers !== null) {
        pendingMarkers.forEach(markerInstance => {
          const pendingBoundaries = markerInstance.pendingBoundaries;
          const transitions = markerInstance.transitions;
          if (
            pendingBoundaries !== null &&
            pendingBoundaries.has(offscreenInstance)
          ) {
            pendingBoundaries.delete(offscreenInstance);
            if (transitions !== null) {
              if (markerInstance.name) {
                addMarkerProgressCallbackToPendingTransition(
                  markerInstance.name,
                  transitions,
                  pendingBoundaries,
                );
              } else {
                transitions.forEach(transition => {
                  addTransitionProgressCallbackToPendingTransition(
                    transition,
                    pendingBoundaries,
                  );
                });
              }
            }
          }
        });
      }
    }
  }
}

function hideOrUnhideAllChildren(finishedWork, isHidden) {
  // Only hide or unhide the top-most host nodes.
  let hostSubtreeRoot = null;

  if (supportsMutation) {
    // We only have the top Fiber that was inserted but we need to recurse down its
    // children to find all the terminal nodes.
    let node: Fiber = finishedWork;
    while (true) {
      if (node.tag === HostComponent) {
        if (hostSubtreeRoot === null) {
          hostSubtreeRoot = node;
          try {
            const instance = node.stateNode;
            if (isHidden) {
              hideInstance(instance);
            } else {
              unhideInstance(node.stateNode, node.memoizedProps);
            }
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      } else if (node.tag === HostText) {
        if (hostSubtreeRoot === null) {
          try {
            const instance = node.stateNode;
            if (isHidden) {
              hideTextInstance(instance);
            } else {
              unhideTextInstance(instance, node.memoizedProps);
            }
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      } else if (
        (node.tag === OffscreenComponent ||
          node.tag === LegacyHiddenComponent) &&
        (node.memoizedState: OffscreenState) !== null &&
        node !== finishedWork
      ) {
        // Found a nested Offscreen component that is hidden.
        // Don't search any deeper. This tree should remain hidden.
      } else if (node.child !== null) {
        node.child.return = node;
        node = node.child;
        continue;
      }

      if (node === finishedWork) {
        return;
      }
      while (node.sibling === null) {
        if (node.return === null || node.return === finishedWork) {
          return;
        }

        if (hostSubtreeRoot === node) {
          hostSubtreeRoot = null;
        }

        node = node.return;
      }

      if (hostSubtreeRoot === node) {
        hostSubtreeRoot = null;
      }

      node.sibling.return = node.return;
      node = node.sibling;
    }
  }
}

function commitAttachRef(finishedWork: Fiber) {
  const ref = finishedWork.ref;
  // ref存在
  if (ref !== null) {
    const instance = finishedWork.stateNode;
    let instanceToUse;
    // 获取ref绑定的节点实例
    switch (finishedWork.tag) {
      case HostComponent:
        instanceToUse = getPublicInstance(instance);
        break;
      default:
        instanceToUse = instance;
    }
    // Moved outside to ensure DCE works with this flag
    if (enableScopeAPI && finishedWork.tag === ScopeComponent) {
      instanceToUse = instance;
    }
    // 如果ref是个函数
    if (typeof ref === 'function') {
      let retVal;
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          //指定 ref 的引用
          retVal = ref(instanceToUse);
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        //指定 ref 的引用
        retVal = ref(instanceToUse);
      }
      if (__DEV__) {
        if (typeof retVal === 'function') {
          console.error(
            'Unexpected return value from a callback ref in %s. ' +
              'A callback ref should not return a function.',
            getComponentNameFromFiber(finishedWork),
          );
        }
      }
    //如果ref不是个函数
    } else {
      if (__DEV__) {
        if (!ref.hasOwnProperty('current')) {
          console.error(
            'Unexpected ref object provided for %s. ' +
              'Use either a ref-setter function or React.createRef().',
            getComponentNameFromFiber(finishedWork),
          );
        }
      }
      // 那仅仅就将ref指向节点实例
      ref.current = instanceToUse;
    }
  }
}

function commitDetachRef(current: Fiber) {
  const currentRef = current.ref;
  if (currentRef !== null) {
    if (typeof currentRef === 'function') {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        current.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          currentRef(null);
        } finally {
          recordLayoutEffectDuration(current);
        }
      } else {
        currentRef(null);
      }
    } else {
      currentRef.current = null;
    }
  }
}

function detachFiberMutation(fiber: Fiber) {
  // Cut off the return pointer to disconnect it from the tree.
  // This enables us to detect and warn against state updates on an unmounted component.
  // It also prevents events from bubbling from within disconnected components.
  //
  // Ideally, we should also clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child.
  // This child itself will be GC:ed when the parent updates the next time.
  //
  // Note that we can't clear child or sibling pointers yet.
  // They're needed for passive effects and for findDOMNode.
  // We defer those fields, and all other cleanup, to the passive phase (see detachFiberAfterEffects).
  //
  // Don't reset the alternate yet, either. We need that so we can detach the
  // alternate's fields in the passive phase. Clearing the return pointer is
  // sufficient for findDOMNode semantics.
  const alternate = fiber.alternate;
  // 如果alternate存在,alternate的父亲置为null
  if (alternate !== null) {
    alternate.return = null;
  }
  // 因为alternate就是fiber,fiber的父亲一定为置为null
  // alternate存在的话,父亲也需要置为null
  fiber.return = null;
}

function detachFiberAfterEffects(fiber: Fiber) {
  const alternate = fiber.alternate;
  // 如果alternate != null 那么将递归执行detachFiberAfterEffects,直到清空alternate
  if (alternate !== null) {
    fiber.alternate = null;
    detachFiberAfterEffects(alternate);
  }

  // Note: Defensively using negation instead of < in case
  // `deletedTreeCleanUpLevel` is undefined.

  // 删除所有关系
  // deletedTreeCleanUpLevel = 3
  if (!(deletedTreeCleanUpLevel >= 2)) {
    // This is the default branch (level 0).
    fiber.child = null;
    fiber.deletions = null;
    fiber.dependencies = null;
    fiber.memoizedProps = null;
    fiber.memoizedState = null;
    fiber.pendingProps = null;
    fiber.sibling = null;
    fiber.stateNode = null;
    fiber.updateQueue = null;

    if (__DEV__) {
      fiber._debugOwner = null;
    }
  } else {
    // Clear cyclical Fiber fields. This level alone is designed to roughly
    // approximate the planned Fiber refactor. In that world, `setState` will be
    // bound to a special "instance" object instead of a Fiber. The Instance
    // object will not have any of these fields. It will only be connected to
    // the fiber tree via a single link at the root. So if this level alone is
    // sufficient to fix memory issues, that bodes well for our plans.

    //删除fiber关联并且删除对应真实节点的关联
    fiber.child = null;
    fiber.deletions = null;
    fiber.sibling = null;

    // The `stateNode` is cyclical because on host nodes it points to the host
    // tree, which has its own pointers to children, parents, and siblings.
    // The other host nodes also point back to fibers, so we should detach that
    // one, too.

    // HostComponent = 5;
    if (fiber.tag === HostComponent) {
      // 获取真实节点
      const hostInstance: Instance = fiber.stateNode;
      if (hostInstance !== null) {
        // 执行清除真实节点方法
        /*
          function detachDeletedInstance(node) {
            // TODO: This function is only called on host components. I don't think all of
            // these fields are relevant.
            delete node[internalInstanceKey];
            delete node[internalPropsKey];
            delete node[internalEventHandlersKey];
            delete node[internalEventHandlerListenersKey];
            delete node[internalEventHandlesSetKey];
          }
        */
        detachDeletedInstance(hostInstance);
      }
    }
    // 删除真实节点
    fiber.stateNode = null;

    // I'm intentionally not clearing the `return` field in this level. We
    // already disconnect the `return` pointer at the root of the deleted
    // subtree (in `detachFiberMutation`). Besides, `return` by itself is not
    // cyclical — it's only cyclical when combined with `child`, `sibling`, and
    // `alternate`. But we'll clear it in the next level anyway, just in case.

    if (__DEV__) {
      fiber._debugOwner = null;
    }

    // 清除所有关联
    if (deletedTreeCleanUpLevel >= 3) {
      // Theoretically, nothing in here should be necessary, because we already
      // disconnected the fiber from the tree. So even if something leaks this
      // particular fiber, it won't leak anything else
      //
      // The purpose of this branch is to be super aggressive so we can measure
      // if there's any difference in memory impact. If there is, that could
      // indicate a React leak we don't know about.
      fiber.return = null;
      fiber.dependencies = null;
      fiber.memoizedProps = null;
      fiber.memoizedState = null;
      fiber.pendingProps = null;
      fiber.stateNode = null;
      // TODO: Move to `commitPassiveUnmountInsideDeletedTreeOnFiber` instead.
      fiber.updateQueue = null;
    }
  }
}

function emptyPortalContainer(current: Fiber) {
  if (!supportsPersistence) {
    return;
  }

  const portal: {
    containerInfo: Container,
    pendingChildren: ChildSet,
    ...
  } = current.stateNode;
  const {containerInfo} = portal;
  const emptyChildSet = createContainerChildSet(containerInfo);
  replaceContainerChildren(containerInfo, emptyChildSet);
}

function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return;
  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent;
    }
    parent = parent.return;
  }

  throw new Error(
    'Expected to find a host parent. This error is likely caused by a bug ' +
      'in React. Please file an issue.',
  );
}

function isHostParent(fiber: Fiber): boolean {
  return (
    fiber.tag === HostComponent ||
    fiber.tag === HostRoot ||
    fiber.tag === HostPortal
  );
}

function getHostSibling(fiber: Fiber): ?Instance {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber;
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null;
      }
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
    while (
      node.tag !== HostComponent &&
      node.tag !== HostText &&
      node.tag !== DehydratedFragment
    ) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      if (node.flags & Placement) {
        // If we don't have a child, try the siblings instead.
        continue siblings;
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      if (node.child === null || node.tag === HostPortal) {
        continue siblings;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }
    // Check if this host node is stable or about to be placed.
    if (!(node.flags & Placement)) {
      // Found it!
      return node.stateNode;
    }
  }
}

function commitPlacement(finishedWork: Fiber): void {
  // 不支持突变 退出
  if (!supportsMutation) {
    return;
  }

  // Recursively insert all host nodes into the parent.

  // 获取finishedWork中的最顶部的节点
  /*
    HostComponent || HostRoot || HostPortal 其中之一
  */
  const parentFiber = getHostParentFiber(finishedWork);

  // Note: these two variables *must* always be updated together.
  switch (parentFiber.tag) {
    case HostComponent: {
      // 获取真实节点
      const parent: Instance = parentFiber.stateNode;
      if (parentFiber.flags & ContentReset) {
        // 在进行任何插入之前，重置parent的文本节点内容
        // setTextContent(domElement, '');
        resetTextContent(parent);
        // Clear ContentReset from the effect tag
        parentFiber.flags &= ~ContentReset;
      }

      // 获取顶部节点的兄弟节点
      const before = getHostSibling(finishedWork);
      // 我们只有被插入的顶部Fiber，所以我们需要向下递归其
      // 子节点来找到所有的终端节点。
      // 插入或追加放置节点
      insertOrAppendPlacementNode(finishedWork, before, parent);
      break;
    }
    case HostRoot:
    case HostPortal: {
      // 如果是HostPortal和HostRoot,那么获取其兄弟节点,
      // 调用insertOrAppendPlacementNodeIntoContainer插入到容器
      const parent: Container = parentFiber.stateNode.containerInfo;
      const before = getHostSibling(finishedWork);
      insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent);
      break;
    }
    // eslint-disable-next-line-no-fallthrough
    default:
      throw new Error(
        'Invalid host parent fiber. This error is likely caused by a bug ' +
          'in React. Please file an issue.',
      );
  }
}

function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber,
  before: ?Instance,
  parent: Container,
): void {
  const {tag} = node;
  const isHost = tag === HostComponent || tag === HostText;
  if (isHost) {
    const stateNode = node.stateNode;
    if (before) {
      insertInContainerBefore(parent, stateNode, before);
    } else {
      appendChildToContainer(parent, stateNode);
    }
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
  } else {
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNodeIntoContainer(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNodeIntoContainer(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}

function insertOrAppendPlacementNode(
  node: Fiber,
  before: ?Instance, //顶部节点的兄弟节点
  parent: Instance
): void {
  const { tag } = node;
  const isHost = tag === HostComponent || tag === HostText;
  // host情况
  if (isHost) {
    // 获取真实节点
    const stateNode = node.stateNode;
    // 如果存在兄弟节点
    if (before) {
      // 在parent之前插入stateNode
      insertBefore(parent, stateNode, before);
    } else {
      // 将真实节点插入到parent下
      appendChild(parent, stateNode);
    }

    // HostPortal情况
  } else if (tag === HostPortal) {
    // If the insertion itself is a portal, then we don't want to traverse
    // down its children. Instead, we'll get insertions from each child in
    // the portal directly.
    // HostText情况
  } else {
    // 如果是Text节点,那么循环调用insertOrAppendPlacementNode,直到为不存在子节点或兄弟节点
    const child = node.child;
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent);
      let sibling = child.sibling;
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent);
        sibling = sibling.sibling;
      }
    }
  }
}


// These are tracked on the stack as we recursively traverse a
// deleted subtree.
// TODO: Update these during the whole mutation phase, not just during
// a deletion.
let hostParent: Instance | Container | null = null;
let hostParentIsContainer: boolean = false;

function commitDeletionEffects(
  root: FiberRoot,
  returnFiber: Fiber,
  deletedFiber: Fiber,
) {
  if (supportsMutation) {
    // We only have the top Fiber that was deleted but we need to recurse down its
    // children to find all the terminal nodes.

    // Recursively delete all host nodes from the parent, detach refs, clean
    // up mounted layout effects, and call componentWillUnmount.

    // We only need to remove the topmost host child in each branch. But then we
    // still need to keep traversing to unmount effects, refs, and cWU. TODO: We
    // could split this into two separate traversals functions, where the second
    // one doesn't include any removeChild logic. This is maybe the same
    // function as "disappearLayoutEffects" (or whatever that turns into after
    // the layout phase is refactored to use recursion).

    // Before starting, find the nearest host parent on the stack so we know
    // which instance/container to remove the children from.
    // TODO: Instead of searching up the fiber return path on every deletion, we
    // can track the nearest host component on the JS stack as we traverse the
    // tree during the commit phase. This would make insertions faster, too.
    let parent = returnFiber;
    findParent: while (parent !== null) {
      switch (parent.tag) {
        case HostComponent: {
          hostParent = parent.stateNode;
          hostParentIsContainer = false;
          break findParent;
        }
        case HostRoot: {
          hostParent = parent.stateNode.containerInfo;
          hostParentIsContainer = true;
          break findParent;
        }
        case HostPortal: {
          hostParent = parent.stateNode.containerInfo;
          hostParentIsContainer = true;
          break findParent;
        }
      }
      parent = parent.return;
    }
    // 如果hostParent为null 说明没有走任何case
    if (hostParent === null) {
      throw new Error(
        'Expected to find a host parent. This error is likely caused by ' +
          'a bug in React. Please file an issue.',
      );
    }
    // 提交删除fiber的effect
    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
    hostParent = null;
    hostParentIsContainer = false;
  } else {
    commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber);
  }

  // 作用:将fiber和alternate的父亲都置为null
  detachFiberMutation(deletedFiber);
}

function recursivelyTraverseDeletionEffects(
  finishedRoot,
  nearestMountedAncestor,
  parent,
) {
  // TODO: Use a static flag to skip trees that don't have unmount effects
  let child = parent.child;
  while (child !== null) {
    commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, child);
    child = child.sibling;
  }
}

function commitDeletionEffectsOnFiber(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
) {
  // 执行Unmount钩子
  onCommitUnmount(deletedFiber);

  // The cases in this outer switch modify the stack before they traverse
  // into their subtree. There are simpler cases in the inner switch
  // that don't modify the stack.
  switch (deletedFiber.tag) {
    case HostComponent: {
      if (!offscreenSubtreeWasHidden) {
        // 分离ref
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
      }
      // Intentional fallthrough to next branch
    }
    // eslint-disable-next-line-no-fallthrough
    case HostText: {
      // We only need to remove the nearest host child. Set the host parent
      // to `null` on the stack to indicate that nested children don't
      // need to be removed.
      if (supportsMutation) {
        // 获取真实父节点
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = null;
        // 对子节点递归执行commitDeletionEffectsOnFiber()
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        // 恢复
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;

        if (hostParent !== null) {
          // 现在，所有的子效果都已经卸载了，我们可以把
          //节点从树中删除
          if (hostParentIsContainer) {
            // 从容器移除子节点
            removeChildFromContainer(
              ((hostParent: any): Container),
              (deletedFiber.stateNode: Instance | TextInstance),
            );
          } else {
            // 移除子节点
            removeChild(
              ((hostParent: any): Instance),
              (deletedFiber.stateNode: Instance | TextInstance),
            );
          }
        }
      } else {
        //对子节点递归执行commitDeletionEffectsOnFiber
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      return;
    }
    case DehydratedFragment: {
      if (enableSuspenseCallback) {
        const hydrationCallbacks = finishedRoot.hydrationCallbacks;
        if (hydrationCallbacks !== null) {
          const onDeleted = hydrationCallbacks.onDeleted;
          if (onDeleted) {
            onDeleted((deletedFiber.stateNode: SuspenseInstance));
          }
        }
      }

      // Dehydrated fragments don't have any children

      // Delete the dehydrated suspense boundary and all of its content.
      if (supportsMutation) {
        if (hostParent !== null) {
          if (hostParentIsContainer) {
            clearSuspenseBoundaryFromContainer(
              ((hostParent: any): Container),
              (deletedFiber.stateNode: SuspenseInstance),
            );
          } else {
            clearSuspenseBoundary(
              ((hostParent: any): Instance),
              (deletedFiber.stateNode: SuspenseInstance),
            );
          }
        }
      }
      return;
    }
    case HostPortal: {
      if (supportsMutation) {
        // When we go into a portal, it becomes the parent to remove from.
        const prevHostParent = hostParent;
        const prevHostParentIsContainer = hostParentIsContainer;
        hostParent = deletedFiber.stateNode.containerInfo;
        hostParentIsContainer = true;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        hostParent = prevHostParent;
        hostParentIsContainer = prevHostParentIsContainer;
      } else {
        emptyPortalContainer(deletedFiber);

        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      return;
    }
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      if (!offscreenSubtreeWasHidden) {
        // 获取具有deletions的fiber的updateQueue
        const updateQueue: FunctionComponentUpdateQueue | null = (deletedFiber.updateQueue: any);
        if (updateQueue !== null) {
          // 获取effects中最后一个effect
          const lastEffect = updateQueue.lastEffect;
          // 如果存在
          if (lastEffect !== null) {
            const firstEffect = lastEffect.next;
            // 获取第一个effect
            let effect = firstEffect;
            do {
              // 获取destroy方法和tag
              const {destroy, tag} = effect;
              if (destroy !== undefined) {
                // HookInsertion = 0b0010    NoHookEffect=  0b0000
                // 不管走下面if分之还是else分支都会执行destroy方法
                // 区别在于走else会记录布局时间
                if ((tag & HookInsertion) !== NoHookEffect) {
                  // 执行destroy方法
                  safelyCallDestroy(
                    deletedFiber,
                    nearestMountedAncestor,
                    destroy,
                  );
                } else if ((tag & HookLayout /*0b0100 */) !== NoHookEffect) {
                  if (enableSchedulingProfiler) {
                    markComponentLayoutEffectUnmountStarted(deletedFiber);
                  }

                  if (
                    enableProfilerTimer &&
                    enableProfilerCommitHooks &&
                    deletedFiber.mode & ProfileMode
                  ) {
                    startLayoutEffectTimer();
                    // 执行destroy方法
                    safelyCallDestroy(
                      deletedFiber,
                      nearestMountedAncestor,
                      destroy,
                    );
                    recordLayoutEffectDuration(deletedFiber);
                  } else {
                    safelyCallDestroy(
                      deletedFiber,
                      nearestMountedAncestor,
                      destroy,
                    );
                  }

                  if (enableSchedulingProfiler) {
                    markComponentLayoutEffectUnmountStopped();
                  }
                }
              }
              // 获取下一个effect
              effect = effect.next;
            } while (effect !== firstEffect);
          }
        }
      }
      //对子节点递归执行commitDeletionEffectsOnFiber
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case ClassComponent: {
      if (!offscreenSubtreeWasHidden) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
        const instance = deletedFiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          // 执行ComponentWillUnmount
          safelyCallComponentWillUnmount(
            deletedFiber,
            nearestMountedAncestor,
            instance,
          );
        }
      }
      //对子节点递归执行commitDeletionEffectsOnFiber
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        safelyDetachRef(deletedFiber, nearestMountedAncestor);
      }
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
    case OffscreenComponent: {
      if (deletedFiber.mode & ConcurrentMode) {
        // If this offscreen component is hidden, we already unmounted it. Before
        // deleting the children, track that it's already unmounted so that we
        // don't attempt to unmount the effects again.
        // TODO: If the tree is hidden, in most cases we should be able to skip
        // over the nested children entirely. An exception is we haven't yet found
        // the topmost host node to delete, which we already track on the stack.
        // But the other case is portals, which need to be detached no matter how
        // deeply they are nested. We should use a subtree flag to track whether a
        // subtree includes a nested portal.
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeWasHidden =
          prevOffscreenSubtreeWasHidden || deletedFiber.memoizedState !== null;
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
      } else {
        recursivelyTraverseDeletionEffects(
          finishedRoot,
          nearestMountedAncestor,
          deletedFiber,
        );
      }
      break;
    }
    default: {
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      );
      return;
    }
  }
}
function commitSuspenseCallback(finishedWork: Fiber) {
  // TODO: Move this to passive phase
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (enableSuspenseCallback && newState !== null) {
    const suspenseCallback = finishedWork.memoizedProps.suspenseCallback;
    if (typeof suspenseCallback === 'function') {
      const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
      if (wakeables !== null) {
        suspenseCallback(new Set(wakeables));
      }
    } else if (__DEV__) {
      if (suspenseCallback !== undefined) {
        console.error('Unexpected type for suspenseCallback.');
      }
    }
  }
}

function commitSuspenseHydrationCallbacks(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
) {
  if (!supportsHydration) {
    return;
  }
  const newState: SuspenseState | null = finishedWork.memoizedState;
  if (newState === null) {
    const current = finishedWork.alternate;
    if (current !== null) {
      const prevState: SuspenseState | null = current.memoizedState;
      if (prevState !== null) {
        const suspenseInstance = prevState.dehydrated;
        if (suspenseInstance !== null) {
          try {
            commitHydratedSuspenseInstance(suspenseInstance);
            if (enableSuspenseCallback) {
              const hydrationCallbacks = finishedRoot.hydrationCallbacks;
              if (hydrationCallbacks !== null) {
                const onHydrated = hydrationCallbacks.onHydrated;
                if (onHydrated) {
                  onHydrated(suspenseInstance);
                }
              }
            }
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
    }
  }
}

function getRetryCache(finishedWork) {
  // TODO: Unify the interface for the retry cache so we don't have to switch
  // on the tag like this.
  switch (finishedWork.tag) {
    case SuspenseComponent:
    case SuspenseListComponent: {
      let retryCache = finishedWork.stateNode;
      if (retryCache === null) {
        retryCache = finishedWork.stateNode = new PossiblyWeakSet();
      }
      return retryCache;
    }
    case OffscreenComponent: {
      const instance: OffscreenInstance = finishedWork.stateNode;
      let retryCache = instance.retryCache;
      if (retryCache === null) {
        retryCache = instance.retryCache = new PossiblyWeakSet();
      }
      return retryCache;
    }
    default: {
      throw new Error(
        `Unexpected Suspense handler tag (${finishedWork.tag}). This is a ` +
          'bug in React.',
      );
    }
  }
}

function attachSuspenseRetryListeners(
  finishedWork: Fiber,
  wakeables: Set<Wakeable>,
) {
  // If this boundary just timed out, then it will have a set of wakeables.
  // For each wakeable, attach a listener so that when it resolves, React
  // attempts to re-render the boundary in the primary (pre-timeout) state.
  const retryCache = getRetryCache(finishedWork);
  wakeables.forEach(wakeable => {
    // Memoize using the boundary fiber to prevent redundant listeners.
    const retry = resolveRetryWakeable.bind(null, finishedWork, wakeable);
    if (!retryCache.has(wakeable)) {
      retryCache.add(wakeable);

      if (enableUpdaterTracking) {
        if (isDevToolsPresent) {
          if (inProgressLanes !== null && inProgressRoot !== null) {
            // If we have pending work still, associate the original updaters with it.
            restorePendingUpdaters(inProgressRoot, inProgressLanes);
          } else {
            throw Error(
              'Expected finished root and lanes to be set. This is a bug in React.',
            );
          }
        }
      }

      wakeable.then(retry, retry);
    }
  });
}

// This function detects when a Suspense boundary goes from visible to hidden.
// It returns false if the boundary is already hidden.
// TODO: Use an effect tag.
export function isSuspenseBoundaryBeingHidden(
  current: Fiber | null,
  finishedWork: Fiber,
): boolean {
  if (current !== null) {
    const oldState: SuspenseState | null = current.memoizedState;
    if (oldState === null || oldState.dehydrated !== null) {
      const newState: SuspenseState | null = finishedWork.memoizedState;
      return newState !== null && newState.dehydrated === null;
    }
  }
  return false;
}

export function commitMutationEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
) {
  // 优先级相关
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  setCurrentDebugFiberInDEV(finishedWork);
  // 进入执行
  commitMutationEffectsOnFiber(finishedWork, root, committedLanes);
  setCurrentDebugFiberInDEV(finishedWork);

  // 重置
  inProgressLanes = null;
  inProgressRoot = null;
}

function recursivelyTraverseMutationEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  // Deletions effects can be scheduled on any fiber type. They need to happen
  // before the children effects hae fired.

  // 获取节点上的deletions标志
  const deletions = parentFiber.deletions;
  // 如果存在
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i];
      try {
        // 执行删除effect
        commitDeletionEffects(root, parentFiber, childToDelete);
      } catch (error) {
        captureCommitPhaseError(childToDelete, parentFiber, error);
      }
    }
  }

  const prevDebugFiber = getCurrentDebugFiberInDEV();
  if (parentFiber.subtreeFlags & MutationMask) {
    let child = parentFiber.child;
    while (child !== null) {
      setCurrentDebugFiberInDEV(child);
      commitMutationEffectsOnFiber(child, root, lanes);
      child = child.sibling;
    }
  }
  setCurrentDebugFiberInDEV(prevDebugFiber);
}

function commitMutationEffectsOnFiber(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
) {
  const current = finishedWork.alternate;
  const flags = finishedWork.flags;

  // The effect flag should be checked *after* we refine the type of fiber,
  // because the fiber tag is more specific. An exception is any flag related
  // to reconcilation, because those can be set on all fiber types.

  // 根据tag判断
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // 递归执行删除effect并且分离ref,执行destroy等
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      // 调和
      commitReconciliationEffects(finishedWork);

      // commitReconciliationEffects执行完毕后,flags应该变为了Placement
      // 判断是否需要更新
      // 作用:执行effect
      if (flags & Update) {
        try {
          // 先卸载
          // 创建effect，并形成链表挂载到fiber.updateQueue.effects上
          commitHookEffectListUnmount(
            HookInsertion | HookHasEffect,
            finishedWork,
            finishedWork.return,
          );
          // 再挂载
          // 依次获取effects链中的creat()方法执行
          commitHookEffectListMount(
            HookInsertion | HookHasEffect,
            finishedWork,
          );
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
        // Layout effects are destroyed during the mutation phase so that all
        // destroy functions for all fibers are called before any create functions.
        // This prevents sibling component effects from interfering with each other,
        // e.g. a destroy function in one component should never override a ref set
        // by a create function in another component during the same commit.
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          finishedWork.mode & ProfileMode
        ) {
          try {
            startLayoutEffectTimer();
            commitHookEffectListUnmount(
              HookLayout | HookHasEffect,
              finishedWork,
              finishedWork.return,
            );
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
          recordLayoutEffectDuration(finishedWork);
        } else {
          try {
            commitHookEffectListUnmount(
              HookLayout | HookHasEffect,
              finishedWork,
              finishedWork.return,
            );
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      return;
    }
    case ClassComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Ref) {
        if (current !== null) {
          safelyDetachRef(current, current.return);
        }
      }

      if (flags & Callback && offscreenSubtreeIsHidden) {
        const updateQueue: UpdateQueue<
          *,
        > | null = (finishedWork.updateQueue: any);
        if (updateQueue !== null) {
          deferHiddenCallbacks(updateQueue);
        }
      }
      return;
    }
    case HostComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Ref) {
        if (current !== null) {
          safelyDetachRef(current, current.return);
        }
      }
      if (supportsMutation) {
        // TODO: ContentReset gets cleared by the children during the commit
        // phase. This is a refactor hazard because it means we must read
        // flags the flags after `commitReconciliationEffects` has already run;
        // the order matters. We should refactor so that ContentReset does not
        // rely on mutating the flag during commit. Like by setting a flag
        // during the render phase instead.
        if (finishedWork.flags & ContentReset) {
          const instance: Instance = finishedWork.stateNode;
          try {
            resetTextContent(instance);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }

        if (flags & Update) {
          const instance: Instance = finishedWork.stateNode;
          if (instance != null) {
            // Commit the work prepared earlier.
            const newProps = finishedWork.memoizedProps;
            // For hydration we reuse the update path but we treat the oldProps
            // as the newProps. The updatePayload will contain the real change in
            // this case.
            const oldProps =
              current !== null ? current.memoizedProps : newProps;
            const type = finishedWork.type;
            // TODO: Type the updateQueue to be specific to host components.
            const updatePayload: null | UpdatePayload = (finishedWork.updateQueue: any);
            finishedWork.updateQueue = null;
            if (updatePayload !== null) {
              try {
                commitUpdate(
                  instance,
                  updatePayload,
                  type,
                  oldProps,
                  newProps,
                  finishedWork,
                );
              } catch (error) {
                captureCommitPhaseError(
                  finishedWork,
                  finishedWork.return,
                  error,
                );
              }
            }
          }
        }
      }
      return;
    }
    case HostText: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Update) {
        if (supportsMutation) {
          if (finishedWork.stateNode === null) {
            throw new Error(
              'This should have a text node initialized. This error is likely ' +
                'caused by a bug in React. Please file an issue.',
            );
          }

          const textInstance: TextInstance = finishedWork.stateNode;
          const newText: string = finishedWork.memoizedProps;
          // For hydration we reuse the update path but we treat the oldProps
          // as the newProps. The updatePayload will contain the real change in
          // this case.
          const oldText: string =
            current !== null ? current.memoizedProps : newText;

          try {
            commitTextUpdate(textInstance, oldText, newText);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      return;
    }
    case HostRoot: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Update) {
        if (supportsMutation && supportsHydration) {
          if (current !== null) {
            const prevRootState: RootState = current.memoizedState;
            if (prevRootState.isDehydrated) {
              try {
                commitHydratedContainer(root.containerInfo);
              } catch (error) {
                captureCommitPhaseError(
                  finishedWork,
                  finishedWork.return,
                  error,
                );
              }
            }
          }
        }
        if (supportsPersistence) {
          const containerInfo = root.containerInfo;
          const pendingChildren = root.pendingChildren;
          try {
            replaceContainerChildren(containerInfo, pendingChildren);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      return;
    }
    case HostPortal: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Update) {
        if (supportsPersistence) {
          const portal = finishedWork.stateNode;
          const containerInfo = portal.containerInfo;
          const pendingChildren = portal.pendingChildren;
          try {
            replaceContainerChildren(containerInfo, pendingChildren);
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      return;
    }
    case SuspenseComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      const offscreenFiber: Fiber = (finishedWork.child: any);

      if (offscreenFiber.flags & Visibility) {
        const offscreenInstance: OffscreenInstance = offscreenFiber.stateNode;
        const newState: OffscreenState | null = offscreenFiber.memoizedState;
        const isHidden = newState !== null;

        // Track the current state on the Offscreen instance so we can
        // read it during an event
        offscreenInstance.isHidden = isHidden;

        if (isHidden) {
          const wasHidden =
            offscreenFiber.alternate !== null &&
            offscreenFiber.alternate.memoizedState !== null;
          if (!wasHidden) {
            // TODO: Move to passive phase
            markCommitTimeOfFallback();
          }
        }
      }

      if (flags & Update) {
        try {
          commitSuspenseCallback(finishedWork);
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
        const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
        if (wakeables !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, wakeables);
        }
      }
      return;
    }
    case OffscreenComponent: {
      const newState: OffscreenState | null = finishedWork.memoizedState;
      const isHidden = newState !== null;
      const wasHidden = current !== null && current.memoizedState !== null;

      if (finishedWork.mode & ConcurrentMode) {
        // Before committing the children, track on the stack whether this
        // offscreen subtree was already hidden, so that we don't unmount the
        // effects again.
        const prevOffscreenSubtreeIsHidden = offscreenSubtreeIsHidden;
        const prevOffscreenSubtreeWasHidden = offscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden || isHidden;
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden || wasHidden;
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        offscreenSubtreeWasHidden = prevOffscreenSubtreeWasHidden;
        offscreenSubtreeIsHidden = prevOffscreenSubtreeIsHidden;
      } else {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      }

      commitReconciliationEffects(finishedWork);

      if (flags & Visibility) {
        const offscreenInstance: OffscreenInstance = finishedWork.stateNode;
        const offscreenBoundary: Fiber = finishedWork;

        // Track the current state on the Offscreen instance so we can
        // read it during an event
        offscreenInstance.isHidden = isHidden;

        if (isHidden) {
          if (!wasHidden) {
            if ((offscreenBoundary.mode & ConcurrentMode) !== NoMode) {
              // Disappear the layout effects of all the children
              recursivelyTraverseDisappearLayoutEffects(offscreenBoundary);
            }
          }
        } else {
          if (wasHidden) {
            // TODO: Move re-appear call here for symmetry?
          }
        }

        if (supportsMutation) {
          // TODO: This needs to run whenever there's an insertion or update
          // inside a hidden Offscreen tree.
          hideOrUnhideAllChildren(offscreenBoundary, isHidden);
        }
      }

      // TODO: Move to passive phase
      if (flags & Update) {
        const offscreenQueue: OffscreenQueue | null = (finishedWork.updateQueue: any);
        if (offscreenQueue !== null) {
          const wakeables = offscreenQueue.wakeables;
          if (wakeables !== null) {
            offscreenQueue.wakeables = null;
            attachSuspenseRetryListeners(finishedWork, wakeables);
          }
        }
      }
      return;
    }
    case SuspenseListComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      if (flags & Update) {
        const wakeables: Set<Wakeable> | null = (finishedWork.updateQueue: any);
        if (wakeables !== null) {
          finishedWork.updateQueue = null;
          attachSuspenseRetryListeners(finishedWork, wakeables);
        }
      }
      return;
    }
    case ScopeComponent: {
      if (enableScopeAPI) {
        recursivelyTraverseMutationEffects(root, finishedWork, lanes);
        commitReconciliationEffects(finishedWork);

        // TODO: This is a temporary solution that allowed us to transition away
        // from React Flare on www.
        if (flags & Ref) {
          if (current !== null) {
            safelyDetachRef(finishedWork, finishedWork.return);
          }
          safelyAttachRef(finishedWork, finishedWork.return);
        }
        if (flags & Update) {
          const scopeInstance = finishedWork.stateNode;
          prepareScopeUpdate(scopeInstance, finishedWork);
        }
      }
      return;
    }
    default: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes);
      commitReconciliationEffects(finishedWork);

      return;
    }
  }
}
function commitReconciliationEffects(finishedWork: Fiber) {
  // Placement effects (insertions, reorders) can be scheduled on any fiber
  // type. They needs to happen after the children effects have fired, but
  // before the effects on this fiber have fired.
  const flags = finishedWork.flags;
  if (flags & Placement) {
    try {
      // 将finishedWork的stateNode中所有的子节点进行添加到顶部节点下,或容器下
      commitPlacement(finishedWork);
    } catch (error) {
      captureCommitPhaseError(finishedWork, finishedWork.return, error);
    }
    // Clear the "placement" from effect tag so that we know that this is
    // inserted, before any life-cycles like componentDidMount gets called.
    // TODO: findDOMNode doesn't rely on this any more but isMounted does
    // and isMounted is deprecated anyway so we should be able to kill this.
    finishedWork.flags &= ~Placement;
  }
  if (flags & Hydrating) {
    finishedWork.flags &= ~Hydrating;
  }
}

export function commitLayoutEffects(
  finishedWork: Fiber,
  root: FiberRoot,
  committedLanes: Lanes,
): void {
  inProgressLanes = committedLanes;
  inProgressRoot = root;

  const current = finishedWork.alternate;
  //执行
  commitLayoutEffectOnFiber(root, current, finishedWork, committedLanes);

  inProgressLanes = null;
  inProgressRoot = null;
}

function recursivelyTraverseLayoutEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  const prevDebugFiber = getCurrentDebugFiberInDEV();
  if (parentFiber.subtreeFlags & LayoutMask) {
    let child = parentFiber.child;
    while (child !== null) {
      setCurrentDebugFiberInDEV(child);
      const current = child.alternate;
      commitLayoutEffectOnFiber(root, current, child, lanes);
      child = child.sibling;
    }
  }
  setCurrentDebugFiberInDEV(prevDebugFiber);
}

function disappearLayoutEffects(finishedWork: Fiber) {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case MemoComponent:
    case SimpleMemoComponent: {
      // TODO (Offscreen) Check: flags & LayoutStatic
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        finishedWork.mode & ProfileMode
      ) {
        try {
          startLayoutEffectTimer();
          commitHookEffectListUnmount(
            HookLayout,
            finishedWork,
            finishedWork.return,
          );
        } finally {
          recordLayoutEffectDuration(finishedWork);
        }
      } else {
        commitHookEffectListUnmount(
          HookLayout,
          finishedWork,
          finishedWork.return,
        );
      }

      recursivelyTraverseDisappearLayoutEffects(finishedWork);
      break;
    }
    case ClassComponent: {
      // TODO (Offscreen) Check: flags & RefStatic
      safelyDetachRef(finishedWork, finishedWork.return);

      const instance = finishedWork.stateNode;
      if (typeof instance.componentWillUnmount === 'function') {
        safelyCallComponentWillUnmount(
          finishedWork,
          finishedWork.return,
          instance,
        );
      }

      recursivelyTraverseDisappearLayoutEffects(finishedWork);
      break;
    }
    case HostComponent: {
      // TODO (Offscreen) Check: flags & RefStatic
      safelyDetachRef(finishedWork, finishedWork.return);

      recursivelyTraverseDisappearLayoutEffects(finishedWork);
      break;
    }
    case OffscreenComponent: {
      const isHidden = finishedWork.memoizedState !== null;
      if (isHidden) {
        // Nested Offscreen tree is already hidden. Don't disappear
        // its effects.
      } else {
        recursivelyTraverseDisappearLayoutEffects(finishedWork);
      }
      break;
    }
    default: {
      recursivelyTraverseDisappearLayoutEffects(finishedWork);
      break;
    }
  }
}

function recursivelyTraverseDisappearLayoutEffects(parentFiber: Fiber) {
  // TODO (Offscreen) Check: flags & (RefStatic | LayoutStatic)
  let child = parentFiber.child;
  while (child !== null) {
    disappearLayoutEffects(child);
    child = child.sibling;
  }
}

function reappearLayoutEffects(
  finishedRoot: FiberRoot,
  current: Fiber | null,
  finishedWork: Fiber,
  committedLanes: Lanes,
  // This function visits both newly finished work and nodes that were re-used
  // from a previously committed tree. We cannot check non-static flags if the
  // node was reused.
  includeWorkInProgressEffects: boolean,
) {
  // Turn on layout effects in a tree that previously disappeared.
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );
      // TODO: Check flags & LayoutStatic
      commitHookLayoutEffects(finishedWork, HookLayout);
      break;
    }
    case ClassComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );

      // TODO: Check for LayoutStatic flag
      const instance = finishedWork.stateNode;
      if (typeof instance.componentDidMount === 'function') {
        try {
          instance.componentDidMount();
        } catch (error) {
          captureCommitPhaseError(finishedWork, finishedWork.return, error);
        }
      }

      // Commit any callbacks that would have fired while the component
      // was hidden.
      const updateQueue: UpdateQueue<
        *,
      > | null = (finishedWork.updateQueue: any);
      if (updateQueue !== null) {
        commitHiddenCallbacks(updateQueue, instance);
      }

      // If this is newly finished work, check for setState callbacks
      if (includeWorkInProgressEffects && flags & Callback) {
        commitClassCallbacks(finishedWork);
      }

      // TODO: Check flags & RefStatic
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    // Unlike commitLayoutEffectsOnFiber, we don't need to handle HostRoot
    // because this function only visits nodes that are inside an
    // Offscreen fiber.
    // case HostRoot: {
    //  ...
    // }
    case HostComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );

      // Renderers may schedule work to be done after host components are mounted
      // (eg DOM renderer may schedule auto-focus for inputs and form controls).
      // These effects should only be committed when components are first mounted,
      // aka when there is no current/alternate.
      if (includeWorkInProgressEffects && current === null && flags & Update) {
        commitHostComponentMount(finishedWork);
      }

      // TODO: Check flags & Ref
      safelyAttachRef(finishedWork, finishedWork.return);
      break;
    }
    case Profiler: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );
      // TODO: Figure out how Profiler updates should work with Offscreen
      if (includeWorkInProgressEffects && flags & Update) {
        commitProfilerUpdate(finishedWork, current);
      }
      break;
    }
    case SuspenseComponent: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );

      // TODO: Figure out how Suspense hydration callbacks should work
      // with Offscreen.
      if (includeWorkInProgressEffects && flags & Update) {
        commitSuspenseHydrationCallbacks(finishedRoot, finishedWork);
      }
      break;
    }
    case OffscreenComponent: {
      const offscreenState: OffscreenState = finishedWork.memoizedState;
      const isHidden = offscreenState !== null;
      if (isHidden) {
        // Nested Offscreen tree is still hidden. Don't re-appear its effects.
      } else {
        recursivelyTraverseReappearLayoutEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          includeWorkInProgressEffects,
        );
      }
      break;
    }
    default: {
      recursivelyTraverseReappearLayoutEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        includeWorkInProgressEffects,
      );
      break;
    }
  }
}

function recursivelyTraverseReappearLayoutEffects(
  finishedRoot: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  includeWorkInProgressEffects: boolean,
) {
  // This function visits both newly finished work and nodes that were re-used
  // from a previously committed tree. We cannot check non-static flags if the
  // node was reused.
  const childShouldIncludeWorkInProgressEffects =
    includeWorkInProgressEffects &&
    (parentFiber.subtreeFlags & LayoutMask) !== NoFlags;

  // TODO (Offscreen) Check: flags & (RefStatic | LayoutStatic)
  const prevDebugFiber = getCurrentDebugFiberInDEV();
  let child = parentFiber.child;
  while (child !== null) {
    const current = child.alternate;
    reappearLayoutEffects(
      finishedRoot,
      current,
      child,
      committedLanes,
      childShouldIncludeWorkInProgressEffects,
    );
    child = child.sibling;
  }
  setCurrentDebugFiberInDEV(prevDebugFiber);
}

// 就是个包装函数
export function commitPassiveMountEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
): void {
  setCurrentDebugFiberInDEV(finishedWork);
  // 执行
  commitPassiveMountOnFiber(
    root,
    finishedWork,
    committedLanes,
    committedTransitions,
  );
  resetCurrentDebugFiberInDEV();
}

function recursivelyTraversePassiveMountEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
) {
  const prevDebugFiber = getCurrentDebugFiberInDEV();
  if (parentFiber.subtreeFlags & PassiveMask) {
    // 获取子节点
    let child = parentFiber.child;
    // 如果子节点存在,将递归进行挂载,直到不存在子节点
    while (child !== null) {
      setCurrentDebugFiberInDEV(child);
      // 在fiber上进行挂载
      commitPassiveMountOnFiber(
        root,
        child,
        committedLanes,
        committedTransitions,
      );
      child = child.sibling;
    }
  }
  setCurrentDebugFiberInDEV(prevDebugFiber);
}

// 作用:查找flag包含Passive的finishedWork执行commitHookEffectListMount()
function commitPassiveMountOnFiber(
  finishedRoot: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
  committedTransitions: Array<Transition> | null,
): void {
  const flags = finishedWork.flags;
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // 递归获取出child
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
      );
      if (flags & Passive) {
        // 执行commitHookEffectListMount()
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          finishedWork.mode & ProfileMode
        ) {
          startPassiveEffectTimer();
          try {
            commitHookEffectListMount(
              HookPassive | HookHasEffect,
              finishedWork,
            );
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
          recordPassiveEffectDuration(finishedWork);
        } else {
          try {
            commitHookEffectListMount(
              HookPassive | HookHasEffect,
              finishedWork,
            );
          } catch (error) {
            captureCommitPhaseError(finishedWork, finishedWork.return, error);
          }
        }
      }
      break;
    }
    case HostRoot: {
      // 递归获取出child
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
      );
      if (flags & Passive) {
        if (enableCache) {
          let previousCache: Cache | null = null;
          if (finishedWork.alternate !== null) {
            previousCache = finishedWork.alternate.memoizedState.cache;
          }
          const nextCache = finishedWork.memoizedState.cache;
          // Retain/release the root cache.
          // Note that on initial mount, previousCache and nextCache will be the same
          // and this retain won't occur. To counter this, we instead retain the HostRoot's
          // initial cache when creating the root itself (see createFiberRoot() in
          // ReactFiberRoot.js). Subsequent updates that change the cache are reflected
          // here, such that previous/next caches are retained correctly.
          if (nextCache !== previousCache) {
            retainCache(nextCache);
            if (previousCache != null) {
              releaseCache(previousCache);
            }
          }
        }

        if (enableTransitionTracing) {
          // Get the transitions that were initiatized during the render
          // and add a start transition callback for each of them
          const root = finishedWork.stateNode;
          const incompleteTransitions = root.incompleteTransitions;
          // Initial render
          if (committedTransitions !== null) {
            committedTransitions.forEach(transition => {
              addTransitionStartCallbackToPendingTransition(transition);
            });

            clearTransitionsForLanes(finishedRoot, committedLanes);
          }

          incompleteTransitions.forEach((markerInstance, transition) => {
            const pendingBoundaries = markerInstance.pendingBoundaries;
            if (pendingBoundaries === null || pendingBoundaries.size === 0) {
              addTransitionCompleteCallbackToPendingTransition(transition);
              incompleteTransitions.delete(transition);
            }
          });

          clearTransitionsForLanes(finishedRoot, committedLanes);
        }
      }
      break;
    }
    case LegacyHiddenComponent:
    case OffscreenComponent: {
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
      );
      if (flags & Passive) {
        if (enableCache) {
          let previousCache: Cache | null = null;
          if (
            finishedWork.alternate !== null &&
            finishedWork.alternate.memoizedState !== null &&
            finishedWork.alternate.memoizedState.cachePool !== null
          ) {
            previousCache = finishedWork.alternate.memoizedState.cachePool.pool;
          }
          let nextCache: Cache | null = null;
          if (
            finishedWork.memoizedState !== null &&
            finishedWork.memoizedState.cachePool !== null
          ) {
            nextCache = finishedWork.memoizedState.cachePool.pool;
          }
          // Retain/release the cache used for pending (suspended) nodes.
          // Note that this is only reached in the non-suspended/visible case:
          // when the content is suspended/hidden, the retain/release occurs
          // via the parent Suspense component (see case above).
          if (nextCache !== previousCache) {
            if (nextCache != null) {
              retainCache(nextCache);
            }
            if (previousCache != null) {
              releaseCache(previousCache);
            }
          }
        }

        if (enableTransitionTracing) {
          const isFallback = finishedWork.memoizedState;
          const queue: OffscreenQueue | null = (finishedWork.updateQueue: any);
          const instance: OffscreenInstance = finishedWork.stateNode;

          if (queue !== null) {
            if (isFallback) {
              const transitions = queue.transitions;
              if (transitions !== null) {
                transitions.forEach(transition => {
                  // Add all the transitions saved in the update queue during
                  // the render phase (ie the transitions associated with this boundary)
                  // into the transitions set.
                  if (instance.transitions === null) {
                    instance.transitions = new Set();
                  }
                  instance.transitions.add(transition);
                });
              }

              const markerInstances = queue.markerInstances;
              if (markerInstances !== null) {
                markerInstances.forEach(markerInstance => {
                  const markerTransitions = markerInstance.transitions;
                  // There should only be a few tracing marker transitions because
                  // they should be only associated with the transition that
                  // caused them
                  if (markerTransitions !== null) {
                    markerTransitions.forEach(transition => {
                      if (instance.transitions === null) {
                        instance.transitions = new Set();
                      } else if (instance.transitions.has(transition)) {
                        if (markerInstance.pendingBoundaries === null) {
                          markerInstance.pendingBoundaries = new Map();
                        }
                        if (instance.pendingMarkers === null) {
                          instance.pendingMarkers = new Set();
                        }

                        instance.pendingMarkers.add(markerInstance);
                      }
                    });
                  }
                });
              }
            }

            finishedWork.updateQueue = null;
          }

          commitTransitionProgress(finishedWork);
        }
      }
      break;
    }
    case CacheComponent: {
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
      );
      if (flags & Passive) {
        if (enableCache) {
          let previousCache: Cache | null = null;
          if (finishedWork.alternate !== null) {
            previousCache = finishedWork.alternate.memoizedState.cache;
          }
          const nextCache = finishedWork.memoizedState.cache;
          // Retain/release the cache. In theory the cache component
          // could be "borrowing" a cache instance owned by some parent,
          // in which case we could avoid retaining/releasing. But it
          // is non-trivial to determine when that is the case, so we
          // always retain/release.
          if (nextCache !== previousCache) {
            retainCache(nextCache);
            if (previousCache != null) {
              releaseCache(previousCache);
            }
          }
        }
      }
      break;
    }
    case TracingMarkerComponent: {
      if (enableTransitionTracing) {
        recursivelyTraversePassiveMountEffects(
          finishedRoot,
          finishedWork,
          committedLanes,
          committedTransitions,
        );
        if (flags & Passive) {
          // Get the transitions that were initiatized during the render
          // and add a start transition callback for each of them
          const instance = finishedWork.stateNode;
          if (
            instance.transitions !== null &&
            (instance.pendingBoundaries === null ||
              instance.pendingBoundaries.size === 0)
          ) {
            instance.transitions.forEach(transition => {
              addMarkerCompleteCallbackToPendingTransition(
                finishedWork.memoizedProps.name,
                instance.transitions,
              );
            });
            instance.transitions = null;
            instance.pendingBoundaries = null;
          }
        }
        break;
      }
      // Intentional fallthrough to next branch
    }
    // eslint-disable-next-line-no-fallthrough
    default: {
      recursivelyTraversePassiveMountEffects(
        finishedRoot,
        finishedWork,
        committedLanes,
        committedTransitions,
      );
      break;
    }
  }
}

export function commitPassiveUnmountEffects(finishedWork: Fiber): void {
  setCurrentDebugFiberInDEV(finishedWork);
  // 进入commitPassiveUnmountOnFiber
  commitPassiveUnmountOnFiber(finishedWork);
  resetCurrentDebugFiberInDEV();
}

// 该方法:会向下遍历
function recursivelyTraversePassiveUnmountEffects(parentFiber: Fiber): void {
  // Deletions effects can be scheduled on any fiber type. They need to happen
  // before the children effects have fired.

  // deletions（记录了需要删除的老fiber）执行真实节点的删除
  const deletions = parentFiber.deletions;

  if ((parentFiber.flags & ChildDeletion) !== NoFlags) {
    if (deletions !== null) {
      // 遍历deletions
      for (let i = 0; i < deletions.length; i++) {
        const childToDelete = deletions[i];
        try {
          nextEffect = childToDelete;
          // 进行具体 delete ,真正执行commitPassiveUnmountEffectsInsideOfDeletedTree_begin
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            childToDelete,
            parentFiber,
          );
        } catch (error) {
          captureCommitPhaseError(childToDelete, parentFiber, error);
        }
      }
    }

    // deletedTreeCleanUpLevel = 3
    if (deletedTreeCleanUpLevel >= 1) {
      // A fiber was deleted from this parent fiber, but it's still part of
      // the previous (alternate) parent fiber's list of children. Because
      // children are a linked list, an earlier sibling that's still alive
      // will be connected to the deleted fiber via its `alternate`:
      //
      //   live fiber
      //   --alternate--> previous live fiber
      //   --sibling--> deleted fiber
      //
      // We can't disconnect `alternate` on nodes that haven't been deleted
      // yet, but we can disconnect the `sibling` and `child` pointers.

      // 将老fiber与子节点，未删除子节点与已删除子节点之间的引用删除
      const previousFiber = parentFiber.alternate;
      if (previousFiber !== null) {
        let detachedChild = previousFiber.child;
        if (detachedChild !== null) {
          previousFiber.child = null;
          do {
            const detachedSibling = detachedChild.sibling;
            // 挨个将 sibling 指向置空
            detachedChild.sibling = null;
            detachedChild = detachedSibling;
          } while (detachedChild !== null);
        }
      }
    }
  }

  const prevDebugFiber = getCurrentDebugFiberInDEV();
  // TODO: Split PassiveMask into separate masks for mount and unmount?
  if (parentFiber.subtreeFlags & PassiveMask) {
    let child = parentFiber.child;
    while (child !== null) {
      setCurrentDebugFiberInDEV(child);
      commitPassiveUnmountOnFiber(child);
      child = child.sibling;
    }
  }
  setCurrentDebugFiberInDEV(prevDebugFiber);
}

// 不管是哪个tag都会执行recursivelyTraversePassiveUnmountEffects()
function commitPassiveUnmountOnFiber(finishedWork: Fiber): void {
  switch (finishedWork.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      // 首先执行
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      // Passive = 0b00000000000000100000000000
      if (finishedWork.flags & Passive) {
        // 判断是否开启性能分析
        if (
          enableProfilerTimer &&
          enableProfilerCommitHooks &&
          finishedWork.mode & ProfileMode
        ) {
          startPassiveEffectTimer();
          commitHookEffectListUnmount(
            HookPassive | HookHasEffect,
            finishedWork,
            finishedWork.return,
          );
          recordPassiveEffectDuration(finishedWork);
        // 不管有没有开启ProfilerTimer,都会执行commitHookEffectListUnmount
        } else {
          commitHookEffectListUnmount(
            HookPassive | HookHasEffect,
            finishedWork,
            finishedWork.return,
          );
        }
      }
      break;
    }
    default: {
      recursivelyTraversePassiveUnmountEffects(finishedWork);
      break;
    }
  }
}

// 同样会向下遍历
function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
  deletedSubtreeRoot: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;

    // Deletion effects fire in parent -> child order
    // TODO: Check if fiber has a PassiveStatic flag
    setCurrentDebugFiberInDEV(fiber);
    // 执行commitPassiveUnmountInsideDeletedTreeOnFiber()
    commitPassiveUnmountInsideDeletedTreeOnFiber(fiber, nearestMountedAncestor);
    resetCurrentDebugFiberInDEV();

    const child = fiber.child;
    // TODO: Only traverse subtree if it has a PassiveStatic flag. (But, if we
    // do this, still need to handle `deletedTreeCleanUpLevel` correctly.)

    // 这里判断是否还有子节点
    // 如果有那么进入下一轮循环
    if (child !== null) {
      child.return = fiber;
      nextEffect = child;
    // 没有子节点就删除完毕了
    } else {
      // 该方法会向上查找，是否有flags包含Passive的fiber
      commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
        deletedSubtreeRoot,
      );
    }
  }
}

// 该方法会向上查找，是否有flags包含Passive的fiber
function commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
  deletedSubtreeRoot: Fiber,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect;
    const sibling = fiber.sibling;
    const returnFiber = fiber.return;

    // deletedTreeCleanUpLevel= 3
    if (deletedTreeCleanUpLevel >= 2) {
      // Recursively traverse the entire deleted tree and clean up fiber fields.
      // This is more aggressive than ideal, and the long term goal is to only
      // have to detach the deleted tree at the root.

      // 执行删除操作
      detachFiberAfterEffects(fiber);
      if (fiber === deletedSubtreeRoot) {
        nextEffect = null;
        return;
      }
    } else {
      // This is the default branch (level 0). We do not recursively clear all
      // the fiber fields. Only the root of the deleted subtree.
      if (fiber === deletedSubtreeRoot) {
        detachFiberAfterEffects(fiber);
        nextEffect = null;
        return;
      }
    }

    // 如果存在兄弟节点,那么兄弟的父亲指向当前的父亲,
    // 并且下一个effect指向兄弟,然后退出循环
    if (sibling !== null) {
      sibling.return = returnFiber;
      nextEffect = sibling;
      return;
    }

    // 这里进入循环是将下一个effect指向父节点
    nextEffect = returnFiber;
  }
}

// 同样会向下遍历，对于遍历到的function组件，执行卸载方法：
function commitPassiveUnmountInsideDeletedTreeOnFiber(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
): void {
  switch (current.tag) {
    case FunctionComponent:
    case ForwardRef:
    case SimpleMemoComponent: {
      if (
        enableProfilerTimer &&
        enableProfilerCommitHooks &&
        current.mode & ProfileMode
      ) {
        startPassiveEffectTimer();
        // 执行卸载方法
        commitHookEffectListUnmount(
          HookPassive,
          current,
          nearestMountedAncestor,
        );
        recordPassiveEffectDuration(current);
      } else {
        // 执行卸载方法
        commitHookEffectListUnmount(
          HookPassive,
          current,
          nearestMountedAncestor,
        );
      }
      break;
    }
    // TODO: run passive unmount effects when unmounting a root.
    // Because passive unmount effects are not currently run,
    // the cache instance owned by the root will never be freed.
    // When effects are run, the cache should be freed here:
    // case HostRoot: {
    //   if (enableCache) {
    //     const cache = current.memoizedState.cache;
    //     releaseCache(cache);
    //   }
    //   break;
    // }
    case LegacyHiddenComponent:
    case OffscreenComponent: {
      if (enableCache) {
        if (
          current.memoizedState !== null &&
          current.memoizedState.cachePool !== null
        ) {
          const cache: Cache = current.memoizedState.cachePool.pool;
          // Retain/release the cache used for pending (suspended) nodes.
          // Note that this is only reached in the non-suspended/visible case:
          // when the content is suspended/hidden, the retain/release occurs
          // via the parent Suspense component (see case above).
          if (cache != null) {
            retainCache(cache);
          }
        }
      }
      break;
    }
    case CacheComponent: {
      if (enableCache) {
        const cache = current.memoizedState.cache;
        releaseCache(cache);
      }
      break;
    }
  }
}

// TODO: Reuse reappearLayoutEffects traversal here?
function invokeLayoutEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListMount(HookLayout | HookHasEffect, fiber);
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode;
        try {
          instance.componentDidMount();
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
    }
  }
}

function invokePassiveEffectMountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListMount(HookPassive | HookHasEffect, fiber);
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
    }
  }
}

function invokeLayoutEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListUnmount(
            HookLayout | HookHasEffect,
            fiber,
            fiber.return,
          );
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
        break;
      }
      case ClassComponent: {
        const instance = fiber.stateNode;
        if (typeof instance.componentWillUnmount === 'function') {
          safelyCallComponentWillUnmount(fiber, fiber.return, instance);
        }
        break;
      }
    }
  }
}

function invokePassiveEffectUnmountInDEV(fiber: Fiber): void {
  if (__DEV__ && enableStrictEffects) {
    // We don't need to re-check StrictEffectsMode here.
    // This function is only called if that check has already passed.
    switch (fiber.tag) {
      case FunctionComponent:
      case ForwardRef:
      case SimpleMemoComponent: {
        try {
          commitHookEffectListUnmount(
            HookPassive | HookHasEffect,
            fiber,
            fiber.return,
          );
        } catch (error) {
          captureCommitPhaseError(fiber, fiber.return, error);
        }
      }
    }
  }
}

export {
  commitPlacement,
  commitAttachRef,
  commitDetachRef,
  invokeLayoutEffectMountInDEV,
  invokeLayoutEffectUnmountInDEV,
  invokePassiveEffectMountInDEV,
  invokePassiveEffectUnmountInDEV,
};
