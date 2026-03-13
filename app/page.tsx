'use client';

import React, { useState, useReducer, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronRight, ChevronDown, Circle, Search, Calendar, Plus, CheckCircle, Loader2, LogOut, Mail, Lock, User as UserIcon, Eye, EyeOff, Trash2, RotateCcw, Type } from 'lucide-react';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, User, updateProfile,
} from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { auth, db, APP_ID } from '@/lib/firebase';

const generateId = () => crypto.randomUUID();

// --- 型定義 ---
interface OutlineNode {
  id: string; text: string; startDate: string; endDate: string;
  isCollapsed: boolean; isCompleted: boolean; children: string[]; parent: string;
}
interface NodesMap { [key: string]: OutlineNode | { id: string; children: string[]; parent: null }; }
type FontSize = 'sm' | 'md' | 'lg';
interface ToastItem { id: string; nodeId: string; nodeText: string; snapshot: NodesMap; timer: ReturnType<typeof setTimeout>; remaining: number; startTime: number; }

// フォントサイズごとのクラス定義（テキスト + 行間）
const fontConfig: Record<FontSize, { text: string; leading: string; py: string }> = {
  sm:  { text: 'text-sm',                  leading: 'leading-5',  py: 'py-0.5' },
  md:  { text: 'text-[15px] sm:text-base', leading: 'leading-6',  py: 'py-1'   },
  lg:  { text: 'text-lg sm:text-xl',       leading: 'leading-8',  py: 'py-1.5' },
};

const createNode = (overrides: Partial<OutlineNode> = {}): OutlineNode => ({
  id: generateId(), text: '', startDate: '', endDate: '',
  isCollapsed: false, isCompleted: false, children: [], parent: 'root', ...overrides,
});

const initialNodes: NodesMap = {
  'root': { id: 'root', children: ['node-1', 'node-2'], parent: null },
  'node-1': createNode({ id: 'node-1', text: 'プロジェクトのキックオフ', startDate: '2026-02-23', endDate: '2026-02-25' }),
  'node-2': createNode({ id: 'node-2', text: '機能要件の定義', children: ['node-3', 'node-4'] }),
  'node-3': createNode({ id: 'node-3', text: 'アウトライン機能の設計', parent: 'node-2' }),
  'node-4': createNode({ id: 'node-4', text: 'カレンダー機能の実装', parent: 'node-2', children: ['node-5'] }),
  'node-5': createNode({ id: 'node-5', text: '開始日・終了日の入力UI', parent: 'node-4' }),
};

interface State { nodes: NodesMap; focusId: string | null; }
const initialState: State = { nodes: initialNodes, focusId: null };

type Action =
  | { type: 'UPDATE_TEXT'; id: string; text: string }
  | { type: 'UPDATE_DATES'; id: string; field: 'startDate' | 'endDate'; value: string }
  | { type: 'TOGGLE_COLLAPSE'; id: string }
  | { type: 'ADD_NODE'; afterId?: string; isRoot?: boolean }
  | { type: 'INDENT'; id: string } | { type: 'UNINDENT'; id: string }
  | { type: 'DELETE'; id: string } | { type: 'MOVE_UP'; id: string } | { type: 'MOVE_DOWN'; id: string }
  | { type: 'SET_FOCUS'; id: string } | { type: 'TOGGLE_COMPLETE'; id: string }
  | { type: 'SET_NODES'; nodes: NodesMap }
  | { type: 'RESTORE_NODES'; nodes: NodesMap };

function reducer(state: State, action: Action): State {
  const nodes: NodesMap = { ...state.nodes };
  const clone = (id: string) => {
    nodes[id] = { ...nodes[id] } as OutlineNode;
    if ((nodes[id] as OutlineNode).children) (nodes[id] as OutlineNode).children = [...(nodes[id] as OutlineNode).children];
    return nodes[id] as OutlineNode;
  };
  const getVisibleList = (): string[] => {
    const list: string[] = [];
    const traverse = (id: string) => {
      if (id !== 'root') list.push(id);
      const n = nodes[id] as OutlineNode;
      if (id === 'root' || !n.isCollapsed) n.children.forEach(traverse);
    };
    traverse('root'); return list;
  };
  switch (action.type) {
    case 'UPDATE_TEXT': { clone(action.id).text = action.text; return { ...state, nodes }; }
    case 'UPDATE_DATES': { const n = clone(action.id); n[action.field] = action.value; return { ...state, nodes }; }
    case 'TOGGLE_COLLAPSE': { clone(action.id).isCollapsed = !(nodes[action.id] as OutlineNode).isCollapsed; return { ...state, nodes }; }
    case 'ADD_NODE': {
      const { afterId, isRoot } = action; const newNode = createNode();
      if (isRoot) { newNode.parent = 'root'; nodes[newNode.id] = newNode; clone('root').children.push(newNode.id); }
      else if (afterId) {
        const parentId = (nodes[afterId] as OutlineNode).parent; newNode.parent = parentId; nodes[newNode.id] = newNode;
        const parent = clone(parentId); parent.children.splice(parent.children.indexOf(afterId) + 1, 0, newNode.id);
      }
      return { ...state, nodes, focusId: newNode.id };
    }
    case 'INDENT': {
      const { id } = action; const node = nodes[id] as OutlineNode; const parent = clone(node.parent);
      const index = parent.children.indexOf(id); if (index === 0) return state;
      const prevSiblingId = parent.children[index - 1];
      let depth = 0; let curr: OutlineNode | undefined = nodes[prevSiblingId] as OutlineNode;
      while (curr && curr.parent !== 'root') { depth++; curr = nodes[curr.parent] as OutlineNode; }
      if (depth >= 4) return state;
      const prevSibling = clone(prevSiblingId); parent.children.splice(index, 1);
      prevSibling.children.push(id); prevSibling.isCollapsed = false; clone(id).parent = prevSiblingId;
      return { ...state, nodes, focusId: id };
    }
    case 'UNINDENT': {
      const { id } = action; const node = nodes[id] as OutlineNode; if (node.parent === 'root') return state;
      const parent = clone(node.parent); const grandParent = clone(parent.parent);
      const parentIndex = grandParent.children.indexOf(node.parent); const nodeIndex = parent.children.indexOf(id);
      parent.children.splice(nodeIndex, 1); grandParent.children.splice(parentIndex + 1, 0, id); clone(id).parent = parent.parent;
      return { ...state, nodes, focusId: id };
    }
    case 'DELETE': {
      const { id } = action; const node = nodes[id] as OutlineNode; if (node.children.length > 0) return state;
      const parent = clone(node.parent);
      if (node.parent === 'root' && parent.children.length === 1 && node.text === '') return state;
      const list = getVisibleList(); const idx = list.indexOf(id); const prevId = idx > 0 ? list[idx - 1] : null;
      parent.children = parent.children.filter((cid: string) => cid !== id); delete nodes[id];
      return { ...state, nodes, focusId: prevId };
    }
    case 'MOVE_UP': { const l = getVisibleList(); const i = l.indexOf(action.id); return i > 0 ? { ...state, focusId: l[i - 1] } : state; }
    case 'MOVE_DOWN': { const l = getVisibleList(); const i = l.indexOf(action.id); return i < l.length - 1 ? { ...state, focusId: l[i + 1] } : state; }
    case 'SET_FOCUS': return { ...state, focusId: action.id };
    case 'TOGGLE_COMPLETE': { clone(action.id).isCompleted = !(nodes[action.id] as OutlineNode).isCompleted; return { ...state, nodes }; }
    case 'SET_NODES': return { ...state, nodes: action.nodes };
    case 'RESTORE_NODES': return { ...state, nodes: action.nodes };
    default: return state;
  }
}

const useFilteredNodes = (nodes: NodesMap, searchQuery: string, filterMode: string) => {
  return useMemo(() => {
    const isFiltering = searchQuery !== "" || filterMode !== 'ALL';
    if (!isFiltering) return { isFiltering: false, matched: new Set<string>() };
    const matched = new Set<string>(); const query = searchQuery.toLowerCase();
    const checkMatch = (id: string): boolean => {
      if (id === 'root') { (nodes[id] as OutlineNode).children.forEach(checkMatch); return false; }
      const node = nodes[id] as OutlineNode;
      const matchQuery = query ? node.text.toLowerCase().includes(query) : true;
      let matchFilter = true;
      if (filterMode === 'ACTIVE') matchFilter = !node.isCompleted;
      if (filterMode === 'COMPLETED') matchFilter = node.isCompleted;
      let childMatch = false;
      node.children.forEach((cid: string) => { if (checkMatch(cid)) childMatch = true; });
      const isMatch = (matchQuery && matchFilter) || childMatch;
      if (isMatch) matched.add(id); return isMatch;
    };
    checkMatch('root'); return { isFiltering, matched };
  }, [nodes, searchQuery, filterMode]);
};

// --- 認証画面 ---
function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const errorMessages: { [key: string]: string } = {
    'auth/email-already-in-use': 'このメールアドレスはすでに使用されています',
    'auth/invalid-email': 'メールアドレスの形式が正しくありません',
    'auth/weak-password': 'パスワードは6文字以上で設定してください',
    'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません',
    'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません',
    'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません',
    'auth/too-many-requests': 'ログイン試行回数が多すぎます。しばらくお待ちください',
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name) await updateProfile(cred.user, { displayName: name });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code || '';
      setError(errorMessages[code] || 'エラーが発生しました。もう一度お試しください');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">My Outliner</h1>
          <p className="text-gray-500 mt-2 text-sm">タスクをアウトライン形式で管理</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <div className="flex bg-gray-100 rounded-lg p-1 mb-6">
            {(['login', 'register'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {m === 'login' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名前</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="山田 太郎"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@email.com" required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '6文字以上' : 'パスワード'} required
                  className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'ログイン' : 'アカウントを作成'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- ツリーアイテム ---
interface TreeItemProps {
  id: string; nodes: NodesMap; dispatch: React.Dispatch<Action>;
  focusId: string | null; matched: Set<string>; isFiltering: boolean; searchQuery: string;
  fontSize: FontSize; onDeleteRequest: (id: string, snapshot: NodesMap) => void;
}

const TreeItem = React.memo(({ id, nodes, dispatch, focusId, matched, isFiltering, searchQuery, fontSize, onDeleteRequest }: TreeItemProps) => {
  const node = nodes[id] as OutlineNode;
  const inputRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  // このノード自身のホバー状態（子への伝播を防ぐためstateで管理）
  const [selfHovered, setSelfHovered] = useState(false);

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
  const hasDates = !!(node.startDate || node.endDate);
  const isFocused = focusId === id;

  const { text: textClass, leading: leadingClass, py: pyClass } = fontConfig[fontSize];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'UNINDENT' : 'INDENT', id }); }
    else if (e.key === 'Enter') { e.preventDefault(); dispatch({ type: 'ADD_NODE', afterId: id }); }
    else if (e.key === 'Backspace' && node.text === '' && inputRef.current?.selectionStart === 0) { e.preventDefault(); dispatch({ type: 'DELETE', id }); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dispatch({ type: 'MOVE_UP', id }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); dispatch({ type: 'MOVE_DOWN', id }); }
  };

  const handleDeleteClick = () => {
    const snapshot = JSON.parse(JSON.stringify(nodes)) as NodesMap;
    dispatch({ type: 'DELETE', id });
    onDeleteRequest(id, snapshot);
  };

  // カレンダーアイコンクリック → 開始日ピッカーを開く
  const handleCalendarIconClick = () => {
    setTimeout(() => startDateRef.current?.showPicker?.(), 50);
  };

  // 日付入力クリック → ピッカーを開く
  const handleStartDateClick = () => {
    setTimeout(() => startDateRef.current?.showPicker?.(), 50);
  };
  const handleEndDateClick = () => {
    setTimeout(() => endDateRef.current?.showPicker?.(), 50);
  };

  // カレンダー表示クラス（selfHoveredで判定 → 子ノードに伝播しない）:
  // hasDates or isFocused → 常時表示
  // selfHovered（デスクトップ） → 表示
  // それ以外: スマホ=opacity-30常時表示, デスクトップ=非表示
  const calendarVisibilityClass = hasDates || isFocused || selfHovered
    ? 'opacity-100'
    : 'opacity-30 sm:opacity-0 transition-opacity duration-150';

  return (
    <div className="flex flex-col relative">
      {/* 行部分のみにホバーを適用（子ノードのdivと分離することで伝播を防ぐ） */}
      <div
        className={`flex items-center ${pyClass}`}
        onMouseEnter={() => setSelfHovered(true)}
        onMouseLeave={() => setSelfHovered(false)}
      >

        {/* 折りたたみアイコン */}
        <div className="w-5 h-5 flex flex-shrink-0 items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded cursor-pointer transition-colors"
          onClick={() => hasChildren && dispatch({ type: 'TOGGLE_COLLAPSE', id })}>
          {hasChildren
            ? (node.isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />)
            : null}
        </div>

        {/* 完了トグル ＋ バレット
            完了済み → CheckCircle（グレー塗り）
            未完了   → Circle（枠線のみ、背景なし） */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_COMPLETE', id })}
          className="relative flex-shrink-0 w-5 h-5 mx-1 flex items-center justify-center transition-colors"
          title={node.isCompleted ? '未完了にする' : '完了にする'}
        >
          {node.isCompleted ? (
            <CheckCircle size={16} className="text-gray-400" />
          ) : (
            <Circle size={16} className="text-gray-400" />
          )}
        </button>

        {/* メインコンテンツ */}
        <div className={`flex-1 flex flex-row items-center ml-1 overflow-hidden transition-all duration-300 ${node.isCompleted ? 'opacity-40 grayscale' : 'opacity-100'}`}>

          {/* テキスト入力（幅可変） */}
          <div className="relative flex-shrink overflow-hidden min-w-[20px]">
            <span className={`invisible whitespace-pre block px-1 ${pyClass} ${textClass} ${leadingClass} pointer-events-none`}>
              {node.text || 'タスクを入力'}
            </span>
            <input
              ref={inputRef}
              value={node.text}
              onChange={e => dispatch({ type: 'UPDATE_TEXT', id, text: e.target.value })}
              onFocus={() => { if (focusId !== id) dispatch({ type: 'SET_FOCUS', id }); }}
              onKeyDown={handleKeyDown}
              placeholder="タスクを入力"
              className={`absolute inset-0 w-full h-full bg-transparent outline-none px-1 ${textClass} ${leadingClass} transition-colors duration-300
                ${isHighlighted ? 'bg-yellow-200/50 rounded' : ''}
                ${node.isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}
            />
          </div>

          {/* リーダー線 */}
          <div className="flex-1 border-t-[0.5px] border-solid border-gray-200 mx-2 min-w-[12px]" />

          {/* カレンダー（開始日・終了日） */}
          <div className={`flex-shrink-0 flex items-center space-x-1 ${calendarVisibilityClass}`}>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <Calendar
                className="w-3 h-3 text-gray-400 ml-1.5 cursor-pointer flex-shrink-0"
                onClick={handleCalendarIconClick}
              />
              <input
                ref={startDateRef}
                type="date"
                value={node.startDate}
                onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'startDate', value: e.target.value })}
                onClick={handleStartDateClick}
                className={`bg-transparent outline-none cursor-pointer w-[108px] text-xs rounded px-1 py-0.5 hover:bg-gray-100 focus:ring-1 focus:ring-blue-400 transition-colors ${!node.startDate ? 'text-gray-400 opacity-70' : 'text-gray-600'}`}
                title="開始日"
              />
            </div>
            <span className="text-gray-300 text-xs">–</span>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <input
                ref={endDateRef}
                type="date"
                value={node.endDate}
                min={node.startDate}
                onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'endDate', value: e.target.value })}
                onClick={handleEndDateClick}
                className={`bg-transparent outline-none cursor-pointer w-[108px] text-xs rounded px-1 py-0.5 hover:bg-gray-100 focus:ring-1 focus:ring-blue-400 transition-colors ${!node.endDate ? 'text-gray-400 opacity-70' : 'text-gray-600'}`}
                title="終了日"
              />
            </div>
          </div>

          {/* ゴミ箱ボタン（selfHoveredで表示制御） */}
          <button
            onClick={handleDeleteClick}
            title="削除"
            className={`flex-shrink-0 ml-1.5 p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors ${selfHovered ? 'opacity-100' : 'opacity-0'}`}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 子ノード ― 縦線は完了ボタン（バレット）の中心から出す
          完了ボタン幅: w-5(20px) + mx-1(4px×2) = 28px
          折りたたみアイコン幅: w-5(20px)
          合計オフセット: 20 + 2(mx-1の左) + 10(w-5の中心) = 32px → ml-8 = 32px */}
      {isExpanded && hasChildren && (
        <div className="relative ml-8 pl-3 border-l border-gray-200">
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
              fontSize={fontSize}
              onDeleteRequest={onDeleteRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
});
TreeItem.displayName = 'TreeItem';

// --- 元に戻すトースト ---
function UndoToast({ toasts, onUndo, onDismiss }: {
  toasts: ToastItem[];
  onUndo: (toast: ToastItem) => void;
  onDismiss: (id: string) => void;
}) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 100);
    return () => clearInterval(interval);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center">
      {toasts.map(toast => {
        const elapsed = Date.now() - toast.startTime;
        const progress = Math.max(0, (8000 - elapsed) / 8000);
        return (
          <div key={toast.id} className="flex items-center gap-3 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-lg min-w-[300px] max-w-[90vw]">
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">「{toast.nodeText || '(空のタスク)'}」を削除しました</p>
              <div className="mt-1.5 h-1 bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 rounded-full" style={{ width: `${progress * 100}%`, transition: 'none' }} />
              </div>
            </div>
            <button onClick={() => onUndo(toast)}
              className="flex-shrink-0 flex items-center gap-1 text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors">
              <RotateCcw size={14} /> 元に戻す
            </button>
            <button onClick={() => onDismiss(toast.id)} className="flex-shrink-0 text-gray-400 hover:text-white transition-colors text-lg leading-none">×</button>
          </div>
        );
      })}
    </div>
  );
}

// --- アウトライナー本体 ---
function OutlinerApp({ user }: { user: User }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('ALL');
  const [title, setTitle] = useState('My Outline');
  const [isLoaded, setIsLoaded] = useState(false);
  const [fontSize, setFontSize] = useState<FontSize>('md');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const prevDataRef = useRef({ nodes: initialState.nodes, title: 'My Outline', fontSize: 'md' as FontSize, filterMode: 'ALL' });

  // Firestoreからロード（ノード・タイトル・設定）
  useEffect(() => {
    const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        const rn = d.nodes || initialNodes;
        const rt = d.title || 'My Outline';
        const rf = (d.fontSize as FontSize) || 'md';
        const rm = d.filterMode || 'ALL';
        const prev = prevDataRef.current;
        if (JSON.stringify(rn) !== JSON.stringify(prev.nodes) || rt !== prev.title) {
          dispatch({ type: 'SET_NODES', nodes: rn });
          setTitle(rt);
        }
        if (rf !== prev.fontSize) setFontSize(rf);
        if (rm !== prev.filterMode) setFilterMode(rm);
        prevDataRef.current = { nodes: rn, title: rt, fontSize: rf, filterMode: rm };
      } else {
        setDoc(docRef, { nodes: initialNodes, title: 'My Outline', fontSize: 'md', filterMode: 'ALL' });
      }
      setIsLoaded(true);
    }, () => setIsLoaded(true));
    return () => unsubscribe();
  }, [user]);

  // ローカル変更をFirestoreに保存
  useEffect(() => {
    if (!isLoaded) return;
    const prev = prevDataRef.current;
    if (
      JSON.stringify(state.nodes) !== JSON.stringify(prev.nodes) ||
      title !== prev.title ||
      fontSize !== prev.fontSize ||
      filterMode !== prev.filterMode
    ) {
      prevDataRef.current = { nodes: state.nodes, title, fontSize, filterMode };
      setDoc(
        doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main'),
        { nodes: state.nodes, title, fontSize, filterMode },
        { merge: true }
      );
    }
  }, [state.nodes, title, fontSize, filterMode, user, isLoaded]);

  const handleDeleteRequest = useCallback((nodeId: string, snapshot: NodesMap) => {
    const node = snapshot[nodeId] as OutlineNode;
    const toastId = generateId();
    const timer = setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toastId)), 8000);
    setToasts(prev => [...prev, { id: toastId, nodeId, nodeText: node?.text || '', snapshot, timer, remaining: 8000, startTime: Date.now() }]);
  }, []);

  const handleUndo = useCallback((toast: ToastItem) => {
    clearTimeout(toast.timer);
    dispatch({ type: 'RESTORE_NODES', nodes: toast.snapshot });
    setToasts(prev => prev.filter(t => t.id !== toast.id));
  }, []);

  const handleDismiss = useCallback((toastId: string) => {
    const toast = toasts.find(t => t.id === toastId);
    if (toast) clearTimeout(toast.timer);
    setToasts(prev => prev.filter(t => t.id !== toastId));
  }, [toasts]);

  const { isFiltering, matched } = useFilteredNodes(state.nodes, searchQuery, filterMode);

  if (!isLoaded) return (
    <div className="min-h-screen flex items-center justify-center bg-white text-gray-400">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  );

  const fontSizeOrder: FontSize[] = ['sm', 'md', 'lg'];

  return (
    <div className="min-h-screen bg-white text-gray-800 font-sans flex flex-col">
      <header className="sticky top-0 bg-white/90 backdrop-blur-sm z-10 border-b border-gray-200 p-3 shadow-sm">
        <div className="w-full max-w-5xl mx-auto flex items-center gap-2">

          {/* 検索バー */}
          <div className="w-44 sm:w-52 flex items-center bg-gray-100 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-blue-400 transition-shadow flex-shrink-0">
            <Search className="w-3.5 h-3.5 text-gray-500 mr-1.5 flex-shrink-0" />
            <input
              type="text"
              placeholder="検索..."
              className="w-full bg-transparent outline-none text-sm placeholder-gray-400"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>

          {/* フィルター */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg flex-shrink-0">
            {(['ALL', 'ACTIVE', 'COMPLETED'] as const).map((m) => (
              <button key={m} onClick={() => setFilterMode(m)}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-all ${filterMode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {m === 'ALL' ? 'すべて' : m === 'ACTIVE' ? '未完了' : '完了済み'}
              </button>
            ))}
          </div>

          {/* 文字サイズ */}
          <div className="flex items-center bg-gray-100 p-0.5 rounded-lg flex-shrink-0" title="文字サイズ">
            <Type className="w-3 h-3 text-gray-400 mx-1" />
            {fontSizeOrder.map((s) => (
              <button key={s} onClick={() => setFontSize(s)}
                className={`w-6 h-6 text-xs font-medium rounded-md transition-all ${fontSize === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
              </button>
            ))}
          </div>

          {/* スペーサー */}
          <div className="flex-1" />

          {/* メールアドレス ＋ ログアウト */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span
              className="text-sm text-gray-500 hidden sm:block max-w-[220px] truncate"
              title={user.email || ''}
            >
              {user.email}
            </span>
            <button
              onClick={() => signOut(auth)}
              title="ログアウト"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-8 pb-24 overflow-x-auto">
        <div className="min-w-[700px] pr-4">
          <div className="mb-8 px-2">
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="text-2xl sm:text-3xl font-bold text-gray-900 bg-transparent outline-none w-full border-b-2 border-transparent hover:border-gray-200 focus:border-blue-400 transition-colors pb-1"
              placeholder="タイトルを入力..."
            />
          </div>

          <div className="tree-root">
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
                fontSize={fontSize}
                onDeleteRequest={handleDeleteRequest}
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

      <UndoToast toasts={toasts} onUndo={handleUndo} onDismiss={handleDismiss} />
    </div>
  );
}

// --- ルート ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
    return () => unsubscribe();
  }, []);

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-white text-gray-400">
      <Loader2 className="w-8 h-8 animate-spin" />
    </div>
  );
  if (!user) return <AuthScreen />;
  return <OutlinerApp user={user} />;
}