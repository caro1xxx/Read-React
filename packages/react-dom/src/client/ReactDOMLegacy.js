/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Container} from './ReactDOMHostConfig';
import type {FiberRoot} from 'react-reconciler/src/ReactInternalTypes';
import type {ReactNodeList} from 'shared/ReactTypes';

import {
  getInstanceFromNode,
  isContainerMarkedAsRoot,
  markContainerAsRoot,
  unmarkContainerAsRoot,
} from './ReactDOMComponentTree';
import {listenToAllSupportedEvents} from '../events/DOMPluginEventSystem';
import {isValidContainerLegacy} from './ReactDOMRoot';
import {
  DOCUMENT_NODE,
  ELEMENT_NODE,
  COMMENT_NODE,
} from '../shared/HTMLNodeType';

import {
  createContainer,
  createHydrationContainer,
  findHostInstanceWithNoPortals,
  updateContainer,
  flushSync,
  getPublicRootInstance,
  findHostInstance,
  findHostInstanceWithWarning,
} from 'react-reconciler/src/ReactFiberReconciler';
import {LegacyRoot} from 'react-reconciler/src/ReactRootTags';
import getComponentNameFromType from 'shared/getComponentNameFromType';
import ReactSharedInternals from 'shared/ReactSharedInternals';
import {has as hasInstance} from 'shared/ReactInstanceMap';

const ReactCurrentOwner = ReactSharedInternals.ReactCurrentOwner;

let topLevelUpdateWarnings;

if (__DEV__) {
  topLevelUpdateWarnings = (container: Container) => {
    if (container._reactRootContainer && container.nodeType !== COMMENT_NODE) {
      const hostInstance = findHostInstanceWithNoPortals(
        container._reactRootContainer.current,
      );
      if (hostInstance) {
        if (hostInstance.parentNode !== container) {
          console.error(
            'render(...): It looks like the React-rendered content of this ' +
              'container was removed without using React. This is not ' +
              'supported and will cause errors. Instead, call ' +
              'ReactDOM.unmountComponentAtNode to empty a container.',
          );
        }
      }
    }

    const isRootRenderedBySomeReact = !!container._reactRootContainer;
    const rootEl = getReactRootElementInContainer(container);
    const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

    if (hasNonRootReactChild && !isRootRenderedBySomeReact) {
      console.error(
        'render(...): Replacing React-rendered children with a new root ' +
          'component. If you intended to update the children of this node, ' +
          'you should instead have the existing children update their state ' +
          'and render the new components instead of calling ReactDOM.render.',
      );
    }

    if (
      container.nodeType === ELEMENT_NODE &&
      ((container: any): Element).tagName &&
      ((container: any): Element).tagName.toUpperCase() === 'BODY'
    ) {
      console.error(
        'render(): Rendering components directly into document.body is ' +
          'discouraged, since its children are often manipulated by third-party ' +
          'scripts and browser extensions. This may lead to subtle ' +
          'reconciliation issues. Try rendering into a container element created ' +
          'for your app.',
      );
    }
  };
}

function getReactRootElementInContainer(container: any) {
  if (!container) {
    return null;
  }

  if (container.nodeType === DOCUMENT_NODE) {
    return container.documentElement;
  } else {
    return container.firstChild;
  }
}

function noopOnRecoverableError() {
  // This isn't reachable because onRecoverableError isn't called in the
  // legacy API.
}

function legacyCreateRootFromDOMContainer(
  container: Container, //dom
  initialChildren: ReactNodeList, //初始子节点
  parentComponent: ?React$Component<any, any>, //父组件
  callback: ?Function,
  isHydrationContainer: boolean, //forceHydrate   false
): FiberRoot {
  if (isHydrationContainer) {
    if (typeof callback === 'function') {
      const originalCallback = callback;
      callback = function() {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }

    const root = createHydrationContainer(
      initialChildren,
      callback,
      container,
      LegacyRoot,
      null, // hydrationCallbacks
      false, // isStrictMode
      false, // concurrentUpdatesByDefaultOverride,
      '', // identifierPrefix
      noopOnRecoverableError,
      // TODO(luna) Support hydration later
      null,
    );
    container._reactRootContainer = root;
    markContainerAsRoot(root.current, container);

    const rootContainerElement =
      container.nodeType === COMMENT_NODE ? container.parentNode : container;
    listenToAllSupportedEvents(rootContainerElement);

    flushSync();
    return root;
  } else {
    // 清除所有兄弟接节点
    // 即先清除<div id="root">下的所有内容
    // 应该是不允许root节点下的原来内容,会用后面的React$Element填充
    let rootSibling;
    while ((rootSibling = container.lastChild)) {
      //removeChild清除
      container.removeChild(rootSibling);
    }

    if (typeof callback === 'function') {
      const originalCallback = callback;
      callback = function() {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }

    const root = createContainer(
      container,
      LegacyRoot,
      null, // hydrationCallbacks
      false, // isStrictMode
      false, // concurrentUpdatesByDefaultOverride,
      '', // identifierPrefix
      noopOnRecoverableError, // onRecoverableError
      null, // transitionCallbacks
    );
    container._reactRootContainer = root;
    markContainerAsRoot(root.current, container);

    const rootContainerElement =
      container.nodeType === COMMENT_NODE ? container.parentNode : container;
    listenToAllSupportedEvents(rootContainerElement);

    // Initial mount should not be batched.
    flushSync(() => {
      updateContainer(initialChildren, root, parentComponent, callback);
    });

    return root;
  }
}

function warnOnInvalidCallback(callback: mixed, callerName: string): void {
  if (__DEV__) {
    if (callback !== null && typeof callback !== 'function') {
      console.error(
        '%s(...): Expected the last optional `callback` argument to be a ' +
          'function. Instead received: %s.',
        callerName,
        callback,
      );
    }
  }
}

function legacyRenderSubtreeIntoContainer(
  parentComponent: ?React$Component<any, any>, //null
  children: ReactNodeList, //App
  container: Container, //dom
  forceHydrate: boolean, //服务器渲染相关
  callback: ?Function,
) {
  if (__DEV__) {
    topLevelUpdateWarnings(container);
    warnOnInvalidCallback(callback === undefined ? null : callback, 'render');
  }

  const maybeRoot = container._reactRootContainer;
  let root: FiberRoot;
  if (!maybeRoot) {
    // 初始化
    root = legacyCreateRootFromDOMContainer(
      container, //dom
      children,
      parentComponent,
      callback,
      forceHydrate,
    );
  } else {
    root = maybeRoot;
    if (typeof callback === 'function') {
      const originalCallback = callback;
      callback = function() {
        const instance = getPublicRootInstance(root);
        originalCallback.call(instance);
      };
    }
    // Update
    updateContainer(children, root, parentComponent, callback);
  }
  return getPublicRootInstance(root);
}

export function findDOMNode(
  componentOrElement: Element | ?React$Component<any, any>,
): null | Element | Text {
  if (__DEV__) {
    const owner = (ReactCurrentOwner.current: any);
    if (owner !== null && owner.stateNode !== null) {
      const warnedAboutRefsInRender = owner.stateNode._warnedAboutRefsInRender;
      if (!warnedAboutRefsInRender) {
        console.error(
          '%s is accessing findDOMNode inside its render(). ' +
            'render() should be a pure function of props and state. It should ' +
            'never access something that requires stale data from the previous ' +
            'render, such as refs. Move this logic to componentDidMount and ' +
            'componentDidUpdate instead.',
          getComponentNameFromType(owner.type) || 'A component',
        );
      }
      owner.stateNode._warnedAboutRefsInRender = true;
    }
  }
  if (componentOrElement == null) {
    return null;
  }
  if ((componentOrElement: any).nodeType === ELEMENT_NODE) {
    return (componentOrElement: any);
  }
  if (__DEV__) {
    return findHostInstanceWithWarning(componentOrElement, 'findDOMNode');
  }
  return findHostInstance(componentOrElement);
}

export function hydrate(
  element: React$Node,
  container: Container,
  callback: ?Function,
) {
  if (__DEV__) {
    console.error(
      'ReactDOM.hydrate is no longer supported in React 18. Use hydrateRoot ' +
        'instead. Until you switch to the new API, your app will behave as ' +
        "if it's running React 17. Learn " +
        'more: https://reactjs.org/link/switch-to-createroot',
    );
  }

  if (!isValidContainerLegacy(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.hydrate() on a container that was previously ' +
          'passed to ReactDOMClient.createRoot(). This is not supported. ' +
          'Did you mean to call hydrateRoot(container, element)?',
      );
    }
  }
  // TODO: throw or warn if we couldn't hydrate?
  return legacyRenderSubtreeIntoContainer(
    null,
    element,
    container,
    true,
    callback,
  );
}


export function render(
  // 这里明确了传入的jsx就是React$Element,即<App>
  element: React$Element<any>,
  container: Container,
  callback: ?Function,
) {
  if (__DEV__) {
    // 提醒React18之后不在支持render,而是使用createRoot
    console.error(
      'ReactDOM.render is no longer supported in React 18. Use createRoot ' +
        'instead. Until you switch to the new API, your app will behave as ' +
        "if it's running React 17. Learn " +
        'more: https://reactjs.org/link/switch-to-createroot',
    );
  }

  // 判断是否是有效的DOM元素
  if (!isValidContainerLegacy(container)) {
    throw new Error('Target container is not a DOM element.');
  }

  if (__DEV__) {
    const isModernRoot =
    // 这里的容器节点即<App>传入isContainerMarkedAsRoot,内部就会判断这个<App>是否以前出现过
    // 如果以前出现过,那么就会返回ture,没有出现过就会返回false
      isContainerMarkedAsRoot(container) &&
    // 这里防止传入空的的container
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.render() on a container that was previously ' +
          'passed to ReactDOMClient.createRoot(). This is not supported. ' +
          'Did you mean to call root.render(element)?',
      );
    }
  }

  return legacyRenderSubtreeIntoContainer(
    null, 
    element,
    container,
    false, 
    callback,
  );
}

export function unstable_renderSubtreeIntoContainer(
  parentComponent: React$Component<any, any>,
  element: React$Element<any>,
  containerNode: Container,
  callback: ?Function,
) {
  if (__DEV__) {
    console.error(
      'ReactDOM.unstable_renderSubtreeIntoContainer() is no longer supported ' +
        'in React 18. Consider using a portal instead. Until you switch to ' +
        "the createRoot API, your app will behave as if it's running React " +
        '17. Learn more: https://reactjs.org/link/switch-to-createroot',
    );
  }

  if (!isValidContainerLegacy(containerNode)) {
    throw new Error('Target container is not a DOM element.');
  }

  if (parentComponent == null || !hasInstance(parentComponent)) {
    throw new Error('parentComponent must be a valid React Component');
  }

  return legacyRenderSubtreeIntoContainer(
    parentComponent,
    element,
    containerNode,
    false,
    callback,
  );
}

export function unmountComponentAtNode(container: Container) {
  if (!isValidContainerLegacy(container)) {
    throw new Error(
      'unmountComponentAtNode(...): Target container is not a DOM element.',
    );
  }

  if (__DEV__) {
    const isModernRoot =
      isContainerMarkedAsRoot(container) &&
      container._reactRootContainer === undefined;
    if (isModernRoot) {
      console.error(
        'You are calling ReactDOM.unmountComponentAtNode() on a container that was previously ' +
          'passed to ReactDOMClient.createRoot(). This is not supported. Did you mean to call root.unmount()?',
      );
    }
  }

  if (container._reactRootContainer) {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const renderedByDifferentReact = rootEl && !getInstanceFromNode(rootEl);
      if (renderedByDifferentReact) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by another copy of React.',
        );
      }
    }

    // Unmount should not be batched.
    flushSync(() => {
      legacyRenderSubtreeIntoContainer(null, null, container, false, () => {
        // $FlowFixMe This should probably use `delete container._reactRootContainer`
        container._reactRootContainer = null;
        unmarkContainerAsRoot(container);
      });
    });
    // If you call unmountComponentAtNode twice in quick succession, you'll
    // get `true` twice. That's probably fine?
    return true;
  } else {
    if (__DEV__) {
      const rootEl = getReactRootElementInContainer(container);
      const hasNonRootReactChild = !!(rootEl && getInstanceFromNode(rootEl));

      // Check if the container itself is a React root node.
      const isContainerReactRoot =
        container.nodeType === ELEMENT_NODE &&
        isValidContainerLegacy(container.parentNode) &&
        !!container.parentNode._reactRootContainer;

      if (hasNonRootReactChild) {
        console.error(
          "unmountComponentAtNode(): The node you're attempting to unmount " +
            'was rendered by React and is not a top-level container. %s',
          isContainerReactRoot
            ? 'You may have accidentally passed in a React root node instead ' +
                'of its container.'
            : 'Instead, have the parent component update its state and ' +
                'rerender in order to remove this component.',
        );
      }
    }

    return false;
  }
}
