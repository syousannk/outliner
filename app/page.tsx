'use client';

import React, { useState, useReducer, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, ChevronDown, Circle, Search, Calendar, Plus, CheckCircle, Loader2 } from 'lucide-react';
import { signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, APP_ID } from '@/lib/firebase';

// --- ユーティリティ ---
const generateId = () => crypto.randomUUID();

interface OutlineNode {
  id: string;
  text: string;
  startDate: string;
  endDate: string;
  isCollapsed: boolean;
  isCompleted: boolean;
  children: string[];
  parent: string;
}

interface NodesMap {
  [key: string]: OutlineNode | { id: string; children: string[]; parent: null };
}

const createNode = (overrides: Partial<OutlineNode> = {}): OutlineNode => ({
  id: generateId(),
  text: '',
  startDate: '',
  endDate: '',
  isCollapsed: false,
  isCompleted: false,
  children: [],
  parent: 'root',
  ...overrides,
});

// --- 初期データ ---
const initialNodes: NodesMap = {
  'root': { id: 'root', children: ['node-1', 'node-2'], parent: null },
  'node-1': createNode({ id: 'node-1', text: 'プロジェクトのキックオフ', startDate: '2026-02-23', endDate: '2026-02-25' }),
  'node-2': createNode({ id: 'node-2', text: '機能要件の定義', children: ['node-3', 'node-4'] }),
  'node-3': createNode({ id: 'node-3', text: 'アウトライン機能の設計', parent: 'node-2' }),
  'node-4': createNode({ id: 'node-4', text: 'カレンダー機能の実装', parent: 'node-2', children: ['node-5'] }),
  'node-5': createNode({ id: 'node-5', text: '開始日・終了日の入力UI', parent: 'node-4' }),
};

interface State {
  nodes: NodesMap;
  focusId: string | null;
}

const initialState: State = {
  nodes: initialNodes,
  focusId: null,
};

type Action =
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_DATES'; id: string; field: 'startDate' | 'endDate'; value: string }
  | { type: 'TOGGLE_COLLAPSE'; id: string }
  | { type: 'ADD_NODE'; afterId?: string; isRoot?: boolean }
  | { type: 'INDENT'; id: string }
  | { type: 'UNINDENT'; id: string }
  | { type: 'DELETE'; id: string }
  | { type: 'MOVE_UP'; id: string }
  | { type: 'MOVE_DOWN'; id: string }
  | { type: 'SET_FOCUS'; id: string }
  | { type: 'TOGGLE_COMPLETE'; id: string }
  | { type: 'SET_NODES'; nodes: NodesMap };

// --- 状態管理 Reducer ---
function reducer(state: State, action: Action): State {
  const nodes: NodesMap = { ...state.nodes };

  const clone = (id: string) => {
    nodes[id] = { ...nodes[id] } as OutlineNode;
    if ((nodes[id] as OutlineNode).children) {
      (nodes[id] as OutlineNode).children = [...(nodes[id] as OutlineNode).children];
    }
    return nodes[id] as OutlineNode;
  };

  const getVisibleList = (): string[] => {
    const list: string[] = [];
    const traverse = (id: string) => {
      if (id !== 'root') list.push(id);
      const n = nodes[id] as OutlineNode;
      if (id === 'root' || !n.isCollapsed) {
        n.children.forEach(traverse);
      }
    };
    traverse('root');
    return list;
  };

  switch (action.type) {
    case 'UPDATE_TEXT': {
      clone(action.id).text = action.text;
      return { ...state, nodes };
    }
    case 'UPDATE_DATES': {
      const n = clone(action.id);
      if (action.field === 'startDate') n.startDate = action.value;
      if (action.field === 'endDate') n.endDate = action.value;
      return { ...state, nodes };
    }
    case 'TOGGLE_COLLAPSE': {
      clone(action.id).isCollapsed = !(nodes[action.id] as OutlineNode).isCollapsed;
      return { ...state, nodes };
    }
    case 'ADD_NODE': {
      const { afterId, isRoot } = action;
      const newNode = createNode();

      if (isRoot) {
        newNode.parent = 'root';
        nodes[newNode.id] = newNode;
        const root = clone('root');
        root.children.push(newNode.id);
      } else if (afterId) {
        const parentId = (nodes[afterId] as OutlineNode).parent;
        newNode.parent = parentId;
        nodes[newNode.id] = newNode;
        const parent = clone(parentId);
        const index = parent.children.indexOf(afterId);
        parent.children.splice(index + 1, 0, newNode.id);
      }
      return { ...state, nodes, focusId: newNode.id };
    }
    case 'INDENT': {
      const { id } = action;
      const node = nodes[id] as OutlineNode;
      const parentId = node.parent;
      const parent = clone(parentId);
      const index = parent.children.indexOf(id);
      if (index === 0) return state;

      const prevSiblingId = parent.children[index - 1];
      let depth = 0;
      let curr: OutlineNode | undefined = nodes[prevSiblingId] as OutlineNode;
      while (curr && curr.parent !== 'root') {
        depth++;
        curr = nodes[curr.parent] as OutlineNode;
      }
      if (depth >= 4) return state;

      const prevSibling = clone(prevSiblingId);
      parent.children.splice(index, 1);
      prevSibling.children.push(id);
      prevSibling.isCollapsed = false;
      clone(id).parent = prevSiblingId;

      return { ...state, nodes, focusId: id };
    }
    case 'UNINDENT': {
      const { id } = action;
      const node = nodes[id] as OutlineNode;
      const parentId = node.parent;
      if (parentId === 'root') return state;

      const parent = clone(parentId);
      const grandParentId = parent.parent;
      const grandParent = clone(grandParentId);

      const parentIndex = grandParent.children.indexOf(parentId);
      const nodeIndex = parent.children.indexOf(id);

      parent.children.splice(nodeIndex, 1);
      grandParent.children.splice(parentIndex + 1, 0, id);
      clone(id).parent = grandParentId;

      return { ...state, nodes, focusId: id };
    }
    case 'DELETE': {
      const { id } = action;
      const node = nodes[id] as OutlineNode;
      if (node.children.length > 0) return state;

      const parent = clone(node.parent);
      if (node.parent === 'root' && parent.children.length === 1 && node.text === '') {
        return state;
      }

      const list = getVisibleList();
      const idx = list.indexOf(id);
      const prevId = idx > 0 ? list[idx - 1] : null;

      parent.children = parent.children.filter((childId: string) => childId !== id);
      delete nodes[id];

      return { ...state, nodes, focusId: prevId };
    }
    case 'MOVE_UP': {
      const list = getVisibleList();
      const idx = list.indexOf(action.id);
      if (idx > 0) return { ...state, focusId: list[idx - 1] };
      return state;
    }
    case 'MOVE_DOWN': {
      const list = getVisibleList();
      const idx = list.indexOf(action.id);
      if (idx !== -1 && idx < list.length - 1) return { ...state, focusId: list[idx + 1] };
      return state;
    }
    case 'SET_FOCUS': {
      return { ...state, focusId: action.id };
    }
    case 'TOGGLE_COMPLETE': {
      clone(action.id).isCompleted = !(nodes[action.id] as OutlineNode).isCompleted;
      return { ...state, nodes };
    }
    case 'SET_NODES': {
      return { ...state, nodes: action.nodes };
    }
    default:
      return state;
  }
}

// --- 検索フィルター用カスタムフック ---
const useFilteredNodes = (nodes: NodesMap, searchQuery: string, filterMode: string) => {
  return useMemo(() => {
    const isFiltering = searchQuery !== "" || filterMode !== 'ALL';
    if (!isFiltering) return { isFiltering: false, matched: new Set<string>() };

    const matched = new Set<string>();
    const query = searchQuery ? searchQuery.toLowerCase() : "";

    const checkMatch = (id: string): boolean => {
      if (id === 'root') {
        (nodes[id] as OutlineNode).children.forEach(checkMatch);
        return false;
      }
      const node = nodes[id] as OutlineNode;
      const matchQuery = query ? node.text.toLowerCase().includes(query) : true;
      let matchFilter = true;
      if (filterMode === 'ACTIVE') matchFilter = !node.isCompleted;
      if (filterMode === 'COMPLETED') matchFilter = node.isCompleted;

      const selfMatch = matchQuery && matchFilter;
      let childMatch = false;
      node.children.forEach((childId: string) => {
        if (checkMatch(childId)) childMatch = true;
      });

      const isMatch = selfMatch || childMatch;
      if (isMatch) matched.add(id);
      return isMatch;
    };

    checkMatch('root');
    return { isFiltering, matched };
  }, [nodes, searchQuery, filterMode]);
};

// --- コンポーネント群 ---

const Bullet = ({ hasChildren, isCollapsed, onToggle }: { hasChildren: boolean; isCollapsed: boolean; onToggle: () => void }) => (
  <div
    className="w-6 h-6 flex flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded cursor-pointer transition-colors"
    onClick={onToggle}
  >
    {hasChildren ? (
      isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />
    ) : (
      <Circle size={8} className="fill-current" />
    )}
  </div>
);

const DateInput = ({ value, min, onChange, placeholder }: { value: string; min?: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder: string }) => (
  <input
    type="date"
    value={value}
    min={min}
    onChange={onChange}
    className={`bg-transparent outline-none cursor-pointer w-[115px] text-xs sm:text-sm rounded px-1.5 py-1 hover:bg-gray-200 focus:ring-1 focus:ring-blue-400 transition-colors ${!value ? 'text-gray-400 opacity-60' : 'text-gray-700'}`}
    title={placeholder}
  />
);

interface TreeItemProps {
  id: string;
  nodes: NodesMap;
  dispatch: React.Dispatch<Action>;
  focusId: string | null;
  matched: Set<string>;
  isFiltering: boolean;
  searchQuery: string;
}

const TreeItem = React.memo(({ id, nodes, dispatch, focusId, matched, isFiltering, searchQuery }: TreeItemProps) => {
  const node = nodes[id] as OutlineNode;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusId === id && inputRef.current) {
      inputRef.current.focus();
      setTimeout(() => {
        if (inputRef.current) {
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  }, [focusId, id]);

  if (isFiltering && !matched.has(id)) return null;

  const hasChildren = node.children.length > 0;
  const isExpanded = isFiltering ? true : !node.isCollapsed;
  const isHighlighted = searchQuery && node.text.toLowerCase().includes(searchQuery.toLowerCase());
  const isFocused = focusId === id;
  const hasDates = !!(node.startDate || node.endDate);
  const showCalendar = hasDates || isFocused;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) dispatch({ type: 'UNINDENT', id });
      else dispatch({ type: 'INDENT', id });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      dispatch({ type: 'ADD_NODE', afterId: id });
    } else if (e.key === 'Backspace') {
      if (node.text === '' && inputRef.current?.selectionStart === 0) {
        e.preventDefault();
        dispatch({ type: 'DELETE', id });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      dispatch({ type: 'MOVE_UP', id });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      dispatch({ type: 'MOVE_DOWN', id });
    }
  };

  return (
    <div className="flex flex-col relative group/node">
      <div className="flex items-center py-1">
        <div className="flex-shrink-0">
          <Bullet
            hasChildren={hasChildren}
            isCollapsed={node.isCollapsed}
            onToggle={() => dispatch({ type: 'TOGGLE_COLLAPSE', id })}
          />
        </div>

        <button
          onClick={() => dispatch({ type: 'TOGGLE_COMPLETE', id })}
          className={`flex-shrink-0 mx-1 flex items-center justify-center transition-colors ${node.isCompleted ? 'text-gray-400' : 'text-gray-300 hover:text-gray-400'}`}
          title={node.isCompleted ? "未完了にする" : "完了にする"}
        >
          {node.isCompleted ? <CheckCircle size={18} /> : <Circle size={18} />}
        </button>

        <div className={`flex-1 flex flex-row items-center ml-1 overflow-hidden transition-all duration-300 ${node.isCompleted ? 'opacity-40 grayscale' : 'opacity-100'}`}>
          <div className="relative flex-shrink overflow-hidden min-w-[20px]">
            <span className="invisible whitespace-pre block px-1 py-1 text-[15px] sm:text-base pointer-events-none">
              {node.text || 'タスクを入力'}
            </span>
            <input
              ref={inputRef}
              value={node.text}
              onChange={e => dispatch({ type: 'UPDATE_TEXT', id, text: e.target.value })}
              onFocus={() => {
                if (focusId !== id) dispatch({ type: 'SET_FOCUS', id });
              }}
              onKeyDown={handleKeyDown}
              placeholder="タスクを入力"
              className={`absolute inset-0 w-full h-full bg-transparent outline-none py-1 text-[15px] sm:text-base transition-colors duration-300 ${isHighlighted ? 'bg-yellow-200/50 rounded px-1' : 'px-1'} ${node.isCompleted ? 'text-gray-500' : 'text-gray-900'}`}
            />
            <div
              className={`absolute top-1/2 left-1 -translate-y-1/2 h-[1.5px] bg-gray-500 transition-all duration-300 ease-out pointer-events-none ${node.isCompleted ? 'w-[calc(100%-8px)]' : 'w-0'}`}
            />
          </div>

          <div className="flex-1 border-t-[0.5px] border-solid border-gray-300 mx-2 min-w-[16px] transition-colors" />

          <div className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 text-sm transition-opacity duration-200 ${showCalendar ? 'opacity-100' : 'opacity-0 focus-within:opacity-100'}`}>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <Calendar className="w-3.5 h-3.5 text-gray-400 ml-2" />
              <DateInput
                value={node.startDate}
                onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'startDate', value: e.target.value })}
                placeholder="開始日"
              />
            </div>
            <span className="text-gray-300">-</span>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <DateInput
                min={node.startDate}
                value={node.endDate}
                onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'endDate', value: e.target.value })}
                placeholder="終了日"
              />
            </div>
          </div>
        </div>
      </div>

      {isExpanded && hasChildren && (
        <div className="relative ml-[11px] pl-4 border-l-[0.5px] border-gray-300 transition-colors">
          {node.children.map((childId: string) => (
            <TreeItem
              key={childId}
              id={childId}
              nodes={nodes}
              dispatch={dispatch}
              focusId={focusId}
              matched={matched}
              isFiltering={isFiltering}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}
    </div>
  );
});

TreeItem.displayName = 'TreeItem';

// --- メインアプリケーション ---
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState('ALL');
  const [title, setTitle] = useState("My Outline");

  const [user, setUser] = useState<User | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const prevDataRef = useRef({ nodes: initialState.nodes, title: "My Outline" });

  // 1. 匿名認証
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Firestoreからデータをロード
  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main');

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const remoteData = docSnap.data();
        const remoteNodes = remoteData.nodes || initialNodes;
        const remoteTitle = remoteData.title || "My Outline";
        const currentRefData = prevDataRef.current;

        if (JSON.stringify(remoteNodes) !== JSON.stringify(currentRefData.nodes) || remoteTitle !== currentRefData.title) {
          prevDataRef.current = { nodes: remoteNodes, title: remoteTitle };
          dispatch({ type: 'SET_NODES', nodes: remoteNodes });
          setTitle(remoteTitle);
        }
      } else {
        setDoc(docRef, { nodes: initialNodes, title: "My Outline" });
      }
      setIsLoaded(true);
    }, (error) => {
      console.error("Firestore Sync Error:", error);
      setIsLoaded(true);
    });

    return () => unsubscribe();
  }, [user]);

  // 3. ローカルの変更をFirestoreに保存
  useEffect(() => {
    if (!user || !isLoaded) return;
    const currentRefData = prevDataRef.current;

    if (JSON.stringify(state.nodes) !== JSON.stringify(currentRefData.nodes) || title !== currentRefData.title) {
      prevDataRef.current = { nodes: state.nodes, title };
      const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main');
      setDoc(docRef, { nodes: state.nodes, title }, { merge: true });
    }
  }, [state.nodes, title, user, isLoaded]);

  const { isFiltering, matched } = useFilteredNodes(state.nodes, searchQuery, filterMode);

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-800 font-sans flex flex-col">

      <header className="sticky top-0 bg-white/90 backdrop-blur-sm z-10 border-b border-gray-200 p-4 shadow-sm flex flex-col items-center">
        <div className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex-1 w-full max-w-2xl flex items-center bg-gray-100 rounded-lg px-4 py-2 focus-within:ring-2 focus-within:ring-blue-400 transition-shadow">
            <Search className="w-5 h-5 text-gray-500 mr-2" />
            <input
              type="text"
              placeholder="タスクを検索..."
              className="w-full bg-transparent outline-none text-[15px] sm:text-base placeholder-gray-400"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center bg-gray-100 p-1 rounded-lg flex-shrink-0">
            {(['ALL', 'ACTIVE', 'COMPLETED'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filterMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {mode === 'ALL' ? 'すべて' : mode === 'ACTIVE' ? '未完了' : '完了済み'}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-8 pb-24 overflow-x-auto">
        <div className="min-w-[700px] pr-4">
          <div className="mb-8 px-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-2xl sm:text-3xl font-bold text-gray-900 bg-transparent outline-none w-full border-b-2 border-transparent hover:border-gray-200 focus:border-blue-400 transition-colors pb-1"
              placeholder="タイトルを入力..."
            />
          </div>

          <div className="tree-root space-y-0.5">
            {(state.nodes['root'] as OutlineNode).children.map((id: string) => (
              <TreeItem
                key={id}
                id={id}
                nodes={state.nodes}
                dispatch={dispatch}
                focusId={state.focusId}
                matched={matched}
                isFiltering={isFiltering}
                searchQuery={searchQuery}
              />
            ))}
          </div>

          {!isFiltering && (state.nodes['root'] as OutlineNode).children.length === 0 && (
            <button
              className="flex items-center text-gray-500 hover:text-gray-900 mt-4 px-2 py-1 rounded transition-colors hover:bg-gray-100"
              onClick={() => dispatch({ type: 'ADD_NODE', isRoot: true })}
            >
              <Plus className="w-4 h-4 mr-2" /> タスクを追加
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
