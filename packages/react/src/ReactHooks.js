/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Dispatcher} from 'react-reconciler/src/ReactInternalTypes';
import type {
  MutableSource,
  MutableSourceGetSnapshotFn,
  MutableSourceSubscribeFn,
  ReactContext,
  StartTransitionOptions,
} from 'shared/ReactTypes';

import ReactCurrentDispatcher from './ReactCurrentDispatcher';

type BasicStateAction<S> = (S => S) | S;
type Dispatch<A> = A => void;


export function getCacheSignal(): AbortSignal {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe This is unstable, thus optional
  return dispatcher.getCacheSignal();
}

export function getCacheForType<T>(resourceType: () => T): T {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe This is unstable, thus optional
  return dispatcher.getCacheForType(resourceType);
}

export function useContext<T>(Context: ReactContext<T>): T {
  const dispatcher = resolveDispatcher();
  // if (__DEV__) {
  //   // TODO: add a more generic warning for invalid values.
  //   if ((Context: any)._context !== undefined) {
  //     const realContext = (Context: any)._context;
  //     // Don't deduplicate because this legitimately causes bugs
  //     // and nobody should be using this in existing code.
  //     if (realContext.Consumer === Context) {
  //       console.error(
  //         'Calling useContext(Context.Consumer) is not supported, may cause bugs, and will be ' +
  //           'removed in a future major release. Did you mean to call useContext(Context) instead?',
  //       );
  //     } else if (realContext.Provider === Context) {
  //       console.error(
  //         'Calling useContext(Context.Provider) is not supported. ' +
  //           'Did you mean to call useContext(Context) instead?',
  //       );
  //     }
  //   }
  // }
  return dispatcher.useContext(Context);
}


function resolveDispatcher() {
  //因为所有hook都是挂载到resolveDispatcher上
  //resolveDispatcher又挂载到了ReactCurrentDispatcher.current上

  // ReactCurrentDispatcher的定义在HooksDispatcherOnMount和HooksDispatcherOnUpdate
  const dispatcher = ReactCurrentDispatcher.current;
  return ((dispatcher: any): Dispatcher);
}

/**
 * 所有的 hooks api 都是挂载在 resolveDispatcher 
 * 中返回的 dispatcher 对象上面的，
 * 也就是挂载在 ReactCurrentDispatcher.current 上面
 */

// useState
export function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useState(initialState);
}

export function useReducer<S, I, A>(
  reducer: (S, A) => S,
  initialArg: I,
  init?: I => S,
): [S, Dispatch<A>] {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useReducer(reducer, initialArg, init);
}

export function useRef<T>(initialValue: T): {|current: T|} {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useRef(initialValue);
}

export function useEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useEffect(create, deps);
}

export function useInsertionEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useInsertionEffect(create, deps);
}

export function useLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<mixed> | void | null,
): void {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useLayoutEffect(create, deps);
}

export function useCallback<T>(
  callback: T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useCallback(callback, deps);
}

export function useMemo<T>(
  create: () => T,
  deps: Array<mixed> | void | null,
): T {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useMemo(create, deps);
}

export function useImperativeHandle<T>(
  ref: {|current: T | null|} | ((inst: T | null) => mixed) | null | void,
  create: () => T,
  deps: Array<mixed> | void | null,
): void {
  const dispatcher = resolveDispatcher();
  //挂载
  return dispatcher.useImperativeHandle(ref, create, deps);
}

export function useDebugValue<T>(
  value: T,
  formatterFn: ?(value: T) => mixed,
): void {
  if (__DEV__) {
    const dispatcher = resolveDispatcher();
    //挂载
    return dispatcher.useDebugValue(value, formatterFn);
  }
}

export const emptyObject = {};

export function useTransition(): [
  boolean,
  (callback: () => void, options?: StartTransitionOptions) => void,
] {
  const dispatcher = resolveDispatcher();
  return dispatcher.useTransition();
}

export function useDeferredValue<T>(value: T): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useDeferredValue(value);
}

export function useId(): string {
  const dispatcher = resolveDispatcher();
  return dispatcher.useId();
}

export function useMutableSource<Source, Snapshot>(
  source: MutableSource<Source>,
  getSnapshot: MutableSourceGetSnapshotFn<Source, Snapshot>,
  subscribe: MutableSourceSubscribeFn<Source, Snapshot>,
): Snapshot {
  const dispatcher = resolveDispatcher();
  return dispatcher.useMutableSource(source, getSnapshot, subscribe);
}

export function useSyncExternalStore<T>(
  subscribe: (() => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T {
  const dispatcher = resolveDispatcher();
  return dispatcher.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
}

export function useCacheRefresh(): <T>(?() => T, ?T) => void {
  const dispatcher = resolveDispatcher();
  // $FlowFixMe This is unstable, thus optional
  return dispatcher.useCacheRefresh();
}
