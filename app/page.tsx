'use client';

import React, { useState, useReducer, useEffect, useRef, useMemo, useCallback } from 'react';
import { Circle, Search, Plus, CheckCircle, Loader2, LogOut, Mail, Lock, User as UserIcon, Eye, EyeOff, Trash2, RotateCcw, RefreshCw, List, CircleDot, CircleCheck, CalendarDays, CalendarCheck2, CalendarX2 } from 'lucide-react';
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
interface ToastItem { id: string; nodeId: string; nodeText: string; snapshot: NodesMap; timer: ReturnType<typeof setTimeout>; remaining: number; startTime: number; }

// 固定スタイル定数
const TEXT_CLASS = 'text-sm';
const LEADING_CLASS = 'leading-5';
const PY_CLASS = 'py-1';
// 日付エリアの固定幅（全階層で右端を揃える）
const DATE_W = 'w-[300px]';

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
  | { type: 'ADD_NODE_BEFORE'; beforeId: string }
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
    case 'ADD_NODE_BEFORE': {
      const { beforeId } = action; const newNode = createNode();
      const parentId = (nodes[beforeId] as OutlineNode).parent; newNode.parent = parentId; nodes[newNode.id] = newNode;
      const parent = clone(parentId); parent.children.splice(parent.children.indexOf(beforeId), 0, newNode.id);
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

// 今日・明日の日付文字列を返す
const getDateStr = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

const useFilteredNodes = (nodes: NodesMap, searchQuery: string, filterMode: string) => {
  return useMemo(() => {
    const isFiltering = searchQuery !== "" || filterMode !== 'ALL';
    if (!isFiltering) return { isFiltering: false, matched: new Set<string>() };
    const matched = new Set<string>(); const query = searchQuery.toLowerCase();
    const today = getDateStr(0);
    const tomorrow = getDateStr(1);

    const checkMatch = (id: string): boolean => {
      if (id === 'root') { (nodes[id] as OutlineNode).children.forEach(checkMatch); return false; }
      const node = nodes[id] as OutlineNode;
      const matchQuery = query ? node.text.toLowerCase().includes(query) : true;
      let matchFilter = true;
      if (filterMode === 'ACTIVE') matchFilter = !node.isCompleted;
      if (filterMode === 'COMPLETED') matchFilter = node.isCompleted;
      // 開始日フィルター
      if (filterMode === 'START_TODAY')    matchFilter = node.startDate === today;
      if (filterMode === 'START_TOMORROW') matchFilter = node.startDate === tomorrow;
      if (filterMode === 'START_OVERDUE')  matchFilter = !!node.startDate && node.startDate < today && !node.isCompleted;
      // 終了日フィルター
      if (filterMode === 'END_TODAY')    matchFilter = node.endDate === today;
      if (filterMode === 'END_TOMORROW') matchFilter = node.endDate === tomorrow;
      if (filterMode === 'END_OVERDUE')  matchFilter = !!node.endDate && node.endDate < today && !node.isCompleted;
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
          <h1 className="text-3xl font-bold text-gray-900">Outliner</h1>
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
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent transition" />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="example@email.com" required
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent transition" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? '6文字以上' : 'パスワード'} required
                  className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-transparent transition" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-3">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-gray-800 hover:bg-gray-900 disabled:bg-gray-300 text-white font-medium rounded-lg text-sm transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === 'login' ? 'ログイン' : 'アカウントを作成'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// --- スマホ複数行取り消し線コンポーネント ---
// textareaのDOMから実際の行数を取得し、下→上の順でアニメーション
function MobileStrikeLines({ text, strikeState, containerRef }: {
  text: string;
  strikeState: 'in' | 'done' | 'out';
  containerRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const lineHeightPx = 20; // leading-5 = 20px
  const paddingPx = 4;     // px-1 = 4px

  // 各行のテキスト幅(px)を計算
  const [lineWidths, setLineWidths] = useState<number[]>([]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Canvasでフォントサイズに合わせてテキスト幅を計測
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // textarea の computed font を取得
    const style = window.getComputedStyle(el);
    ctx.font = `${style.fontSize} ${style.fontFamily}`;

    const containerWidth = el.clientWidth - paddingPx * 2;
    const words = text.split('');
    const lines: string[] = [];
    let currentLine = '';

    // 1文字ずつ追加して折り返し計算
    for (const char of words) {
      const testLine = currentLine + char;
      if (ctx.measureText(testLine).width > containerWidth && currentLine !== '') {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    if (lines.length === 0) lines.push('');

    setLineWidths(lines.map(line => Math.min(ctx.measureText(line).width, containerWidth)));
  }, [text, containerRef]);

  const lineCount = lineWidths.length;
  const perLine = 0.4; // 1行あたりのアニメーション時間（秒）

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {lineWidths.map((width, i) => {
        // 完了時: 上→下（i=0が先）
        // 取消時: 下→上（i=lineCount-1が先）
        const orderIdx = strikeState === 'out' ? (lineCount - 1 - i) : i;
        const delay = orderIdx * perLine;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: paddingPx,
              width: width,
              top: i * lineHeightPx + lineHeightPx / 2 - 1,
              height: 1.5,
              backgroundColor: '#9ca3af',
              clipPath: strikeState === 'done' ? 'inset(0 0% 0 0)' : undefined,
              animation: strikeState !== 'done'
                ? `${strikeState === 'out' ? 'hide-rtl' : 'reveal-ltr'} ${perLine}s ease-out ${delay}s both`
                : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

// --- ツリーアイテム ---
interface TreeItemProps {
  id: string; nodes: NodesMap; dispatch: React.Dispatch<Action>;
  focusId: string | null; matched: Set<string>; isFiltering: boolean; searchQuery: string;
  onDeleteRequest: (id: string, snapshot: NodesMap) => void;
}

const TreeItem = React.memo(({ id, nodes, dispatch, focusId, matched, isFiltering, searchQuery, onDeleteRequest }: TreeItemProps) => {
  const node = nodes[id] as OutlineNode;
  const mobileInputRef = useRef<HTMLTextAreaElement>(null);
  const desktopInputRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const endDateRef = useRef<HTMLInputElement>(null);
  const [selfHovered, setSelfHovered] = useState(false);

  // 取り消し線アニメーション状態
  // 'in'=完了アニメ中(左→右), 'done'=完了済み静止, 'out'=取消アニメ中(右→左), null=非表示
  const [strikeState, setStrikeState] = useState<'in' | 'done' | 'out' | null>(
    node.isCompleted ? 'done' : null
  );
  const prevCompleted = useRef(node.isCompleted);

  useEffect(() => {
    if (node.isCompleted === prevCompleted.current) return;
    prevCompleted.current = node.isCompleted;
    if (node.isCompleted) {
      setStrikeState('in');
      const t = setTimeout(() => setStrikeState('done'), 1000);
      return () => clearTimeout(t);
    } else {
      setStrikeState('out');
      const t = setTimeout(() => setStrikeState(null), 1000);
      return () => clearTimeout(t);
    }
  }, [node.isCompleted]);

  // textareaの高さを自動調整（初期表示・テキスト変更時）
  useEffect(() => {
    const el = mobileInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [node.text]);

  useEffect(() => {
    if (focusId !== id) return;
    const isMobile = window.innerWidth < 640;
    const el = isMobile ? mobileInputRef.current : desktopInputRef.current;
    if (!el) return;
    const tryFocus = (attempts = 0) => {
      if (el.isConnected) {
        el.focus();
        try { const len = el.value.length; el.setSelectionRange(len, len); } catch {}
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (attempts < 8) {
        requestAnimationFrame(() => tryFocus(attempts + 1));
      }
    };
    requestAnimationFrame(() => tryFocus());
  }, [focusId, id]);

  if (isFiltering && !matched.has(id)) return null;

  const hasChildren = node.children.length > 0;
  const isExpanded = isFiltering ? true : !node.isCollapsed;
  const isHighlighted = !!(searchQuery && node.text.toLowerCase().includes(searchQuery.toLowerCase()));
  const hasDates = !!(node.startDate || node.endDate);
  const isFocused = focusId === id;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Tab') { e.preventDefault(); dispatch({ type: e.shiftKey ? 'UNINDENT' : 'INDENT', id }); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const pos = (e.target as HTMLInputElement | HTMLTextAreaElement).selectionStart ?? 0;
      if (pos === 0 && node.text.length > 0) { dispatch({ type: 'ADD_NODE_BEFORE', beforeId: id }); }
      else { dispatch({ type: 'ADD_NODE', afterId: id }); }
    }
    else if (e.key === 'Backspace') {
      const el = (e.target as HTMLInputElement | HTMLTextAreaElement);
      if (node.text === '' && el.selectionStart === 0) { e.preventDefault(); dispatch({ type: 'DELETE', id }); }
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dispatch({ type: 'MOVE_UP', id }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); dispatch({ type: 'MOVE_DOWN', id }); }
  };

  const handleDeleteClick = () => {
    const snapshot = JSON.parse(JSON.stringify(nodes)) as NodesMap;
    dispatch({ type: 'DELETE', id });
    onDeleteRequest(id, snapshot);
  };

  // showPicker() でカレンダーを開く

  // 日付エリアの表示: 日付あり → 常時、なし → ホバー/フォーカス時のみ
  const showDateArea = hasDates || isFocused || selfHovered;
  // PC用: ホバー/フォーカス/日付あり時のみ表示
  const pcDateClass = showDateArea ? 'opacity-100' : 'opacity-0';
  // スマホ用: 日付なしでも opacity-50 で常時表示
  const mobileDateClass = hasDates ? 'opacity-100' : 'opacity-50';

  // 日付エリア（PC・スマホ共通）
  // ×ボタンは常時レンダリング（日付なし時は invisible）して幅を確保しズレを防ぐ
  const dateArea = (
    <div className="flex items-center gap-1">
      {/* 開始日 */}
      <div className="relative flex items-center bg-gray-100 rounded-md border border-gray-200 hover:border-gray-300 focus-within:border-gray-400 focus-within:bg-white transition-all overflow-hidden">
        <input ref={startDateRef} type="date" value={node.startDate}
          onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'startDate', value: e.target.value })}
          className={`bg-transparent outline-none cursor-pointer w-[120px] text-xs rounded px-2 py-0.5 hover:bg-gray-100 focus:ring-1 focus:ring-gray-300 transition-colors
            ${!node.startDate ? 'text-gray-500' : 'text-gray-600'}`}
          title="開始日" />
        <button
          onClick={() => node.startDate && dispatch({ type: 'UPDATE_DATES', id, field: 'startDate', value: '' })}
          className={`px-1 text-gray-300 hover:text-gray-500 transition-colors text-xs leading-none ${node.startDate ? 'visible' : 'invisible'}`}
          title="開始日を削除">×</button>
        {/* 完了時の取り消し線 */}
        {node.isCompleted && node.startDate && (
          <div className="pointer-events-none absolute inset-0 flex items-center px-2">
            <div className="w-full h-px bg-gray-400" />
          </div>
        )}
      </div>
      <span className="text-gray-300 text-xs flex-shrink-0">–</span>
      {/* 終了日 */}
      <div className="relative flex items-center bg-gray-100 rounded-md border border-gray-200 hover:border-gray-300 focus-within:border-gray-400 focus-within:bg-white transition-all overflow-hidden">
        <input ref={endDateRef} type="date" value={node.endDate} min={node.startDate}
          onChange={e => dispatch({ type: 'UPDATE_DATES', id, field: 'endDate', value: e.target.value })}
          className={`bg-transparent outline-none cursor-pointer w-[120px] text-xs rounded px-2 py-0.5 hover:bg-gray-100 focus:ring-1 focus:ring-gray-300 transition-colors
            ${!node.endDate ? 'text-gray-500' : 'text-gray-600'}`}
          title="終了日" />
        <button
          onClick={() => node.endDate && dispatch({ type: 'UPDATE_DATES', id, field: 'endDate', value: '' })}
          className={`px-1 text-gray-300 hover:text-gray-500 transition-colors text-xs leading-none ${node.endDate ? 'visible' : 'invisible'}`}
          title="終了日を削除">×</button>
        {/* 完了時の取り消し線 */}
        {node.isCompleted && node.endDate && (
          <div className="pointer-events-none absolute inset-0 flex items-center px-2">
            <div className="w-full h-px bg-gray-400" />
          </div>
        )}
      </div>
    </div>
  );

  // 取り消し線アニメーション
  // 取り消し線 + グレーテキスト層
  // グレーテキスト層はinputと同じスタイルで上に重ねる
  // PC(input): absolute inset-0 なので同じクラスで合う
  // スマホ(textarea): 同じクラスで重ねると高さが合わないので、
  //   グレー層も textarea と全く同じ style で配置する
  const grayTextClass = strikeState === 'in'   ? 'gray-text-in'   :
                        strikeState === 'done'  ? 'gray-text-done' :
                        strikeState === 'out'   ? 'gray-text-out'  : '';

  const strikeLine = strikeState ? (
    <span className={"strike-line " + strikeState} />
  ) : null;

  return (
    <div className="mb-0.5">
      <div className="flex flex-row">

        {/* バレット列
            ・バレットボタン自身に PY_CLASS を持たせてコンテンツ行と高さを揃える
            ・縦線は flex-1 でボタン直下〜子ノードコンテナ末端まで伸びる */}
        <div className="flex flex-col flex-shrink-0 w-7">
          <button
            onClick={() => dispatch({ type: 'TOGGLE_COMPLETE', id })}
            className={`w-5 mx-1 ${PY_CLASS} flex items-center justify-center transition-opacity duration-500 ${node.isCompleted ? 'opacity-40' : ''}`}
            title={node.isCompleted ? '未完了にする' : '完了にする'}
          >
            {node.isCompleted
              ? <CheckCircle size={16} className="text-gray-400" />
              : <Circle size={16} className="text-gray-400" />}
          </button>
          {isExpanded && hasChildren && (
            <div className="flex-1 border-l border-gray-200 ml-[13px]" />
          )}
        </div>

        {/* コンテンツ列 */}
        <div className="flex-1 min-w-0">

          {/* PC レイアウト: flex-row でリーダー線・日付・ゴミ箱を横並び */}
          <div
            className="hidden sm:flex sm:flex-row sm:items-center"
            onMouseEnter={() => setSelfHovered(true)}
            onMouseLeave={() => setSelfHovered(false)}
          >
            {/* テキスト（幅可変・inline-block サイズ計算） */}
            <div className={`relative flex-shrink overflow-hidden min-w-[20px] transition-opacity duration-500 ${node.isCompleted ? 'opacity-40' : ''}`}>
              {/* 幅計算用スペーサー：PY_CLASS + テキストクラスでバレットと高さを揃える */}
              <span className={`invisible whitespace-pre block px-1 ${PY_CLASS} ${TEXT_CLASS} ${LEADING_CLASS} pointer-events-none`}>
                {node.text || 'タスクを入力'}
              </span>
              <input
                ref={desktopInputRef}
                value={node.text}
                onChange={e => dispatch({ type: 'UPDATE_TEXT', id, text: e.target.value })}
                onFocus={() => { if (focusId !== id) dispatch({ type: 'SET_FOCUS', id }); }}
                onKeyDown={handleKeyDown}
                placeholder="タスクを入力"
                className={`absolute inset-0 w-full h-full bg-transparent outline-none px-1 ${TEXT_CLASS} ${LEADING_CLASS}
                  ${isHighlighted ? 'bg-yellow-200/50 rounded' : ''}
                  transition-colors duration-1000 ${node.isCompleted ? 'text-gray-400' : 'text-gray-900'}`}
              />
              {/* 取り消し線のみ */}
              {strikeState && (
                <div className="pointer-events-none absolute inset-0 flex items-center px-1" aria-hidden>
                  <span className={`relative whitespace-pre ${TEXT_CLASS} ${LEADING_CLASS}`} style={{ color: 'transparent' }}>
                    {node.text || '\u00A0'}
                    {strikeLine}
                  </span>
                </div>
              )}
            </div>

            {/* リーダー線: 日付あり or ホバー/フォーカス時のみ表示 */}
            {(hasDates || isFocused || selfHovered) ? (
              <div className="flex-1 border-t-[0.5px] border-solid border-gray-200 mx-2 min-w-[12px]" />
            ) : (
              <div className="flex-1 mx-2 min-w-[12px]" />
            )}

            {/* 日付エリア：固定幅で全階層の右端を揃える */}
            <div className={`flex-shrink-0 ${DATE_W} flex justify-start transition-opacity duration-150 ${node.isCompleted ? 'opacity-40' : pcDateClass}`}>
              {dateArea}
            </div>

            {/* ゴミ箱 */}
            <button onClick={handleDeleteClick} title="削除"
              className={`flex-shrink-0 ml-1.5 p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors ${selfHovered ? 'opacity-100' : 'opacity-0'}`}>
              <Trash2 size={13} />
            </button>
          </div>

          {/* スマホ レイアウト */}
          <div
            className="sm:hidden"
            onMouseEnter={() => setSelfHovered(true)}
            onMouseLeave={() => setSelfHovered(false)}
          >
            {/* 1行目: テキスト + ゴミ箱 */}
            <div className="flex items-center">
              <div className={`flex-1 min-w-0 transition-opacity duration-500 ${node.isCompleted ? 'opacity-40' : ''}`}>
                <div className="relative">
                  <textarea
                    ref={mobileInputRef}
                    value={node.text}
                    rows={1}
                    onChange={e => {
                      const val = e.target.value;
                      if (val.includes('\n')) {
                        const pos = e.target.selectionStart - 1;
                        const textBefore = val.slice(0, val.indexOf('\n'));
                        if (pos === 0 && node.text.length > 0) {
                          dispatch({ type: 'ADD_NODE_BEFORE', beforeId: id });
                        } else {
                          dispatch({ type: 'UPDATE_TEXT', id, text: textBefore });
                          dispatch({ type: 'ADD_NODE', afterId: id });
                        }
                        return;
                      }
                      // 高さを自動調整
                      e.target.style.height = 'auto';
                      e.target.style.height = e.target.scrollHeight + 'px';
                      dispatch({ type: 'UPDATE_TEXT', id, text: val });
                    }}
                    onFocus={() => { if (focusId !== id) dispatch({ type: 'SET_FOCUS', id }); }}
                    onKeyDown={handleKeyDown}
                    placeholder="タスクを入力"
                    style={{ resize: 'none', overflow: 'hidden' }}
                    className={`w-full bg-transparent outline-none px-1 ${TEXT_CLASS} ${LEADING_CLASS}
                      ${isHighlighted ? 'bg-yellow-200/50 rounded' : ''}
                      transition-colors duration-1000 ${node.isCompleted ? 'text-gray-400' : 'text-gray-900'}`}
                  />
                  {/* 取り消し線: 行ごとに下→上の順でアニメーション */}
                  {strikeState && (
                    <MobileStrikeLines
                      text={node.text}
                      strikeState={strikeState}
                      containerRef={mobileInputRef}
                    />
                  )}
                </div>
              </div>
              <button onClick={handleDeleteClick} title="削除"
                className="flex-shrink-0 ml-1 p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors">
                <Trash2 size={13} />
              </button>
            </div>

            {/* 2行目: 日付 - スマホでは日付なしでも薄く常時表示 */}
            <div className={`mt-1 ${hasDates ? 'pb-3' : 'pb-1'}`}>
              <div className={`transition-opacity duration-150 ${node.isCompleted ? 'opacity-40' : mobileDateClass}`}>
                {dateArea}
              </div>
            </div>
          </div>

          {/* 子ノード */}
          {isExpanded && hasChildren && (
            <div>
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
                  onDeleteRequest={onDeleteRequest}
                />
              ))}
            </div>
          )}
        </div>
      </div>
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
                <div className="h-full bg-gray-400 rounded-full" style={{ width: `${progress * 100}%`, transition: 'none' }} />
              </div>
            </div>
            <button onClick={() => onUndo(toast)}
              className="flex-shrink-0 flex items-center gap-1 text-gray-300 hover:text-white text-sm font-medium transition-colors">
              <RotateCcw size={14} /> 元に戻す
            </button>
            <button onClick={() => onDismiss(toast.id)} className="flex-shrink-0 text-gray-500 hover:text-white transition-colors text-lg leading-none">×</button>
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
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const prevDataRef = useRef({ nodes: initialState.nodes, title: 'My Outline', filterMode: 'ALL' });

  // Firestoreからロード
  useEffect(() => {
    const docRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main');
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const d = docSnap.data();
        const rn = d.nodes || initialNodes;
        const rt = d.title || 'My Outline';
        const rm = d.filterMode || 'ALL';
        const prev = prevDataRef.current;
        if (JSON.stringify(rn) !== JSON.stringify(prev.nodes) || rt !== prev.title) {
          dispatch({ type: 'SET_NODES', nodes: rn });
          setTitle(rt);
        }
        if (rm !== prev.filterMode) setFilterMode(rm);
        prevDataRef.current = { nodes: rn, title: rt, filterMode: rm };
      } else {
        setDoc(docRef, { nodes: initialNodes, title: 'My Outline', filterMode: 'ALL' });
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
      filterMode !== prev.filterMode
    ) {
      prevDataRef.current = { nodes: state.nodes, title, filterMode };
      setDoc(
        doc(db, 'artifacts', APP_ID, 'users', user.uid, 'outline', 'main'),
        { nodes: state.nodes, title, filterMode },
        { merge: true }
      );
    }
  }, [state.nodes, title, filterMode, user, isLoaded]);

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

  return (
    <div className="min-h-screen bg-white text-gray-800 font-sans flex flex-col">
      <header className="sticky top-0 bg-white/90 backdrop-blur-sm z-10 border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-8 py-2 flex flex-col gap-2">

          {/* 1行目：アイコン ＋ 検索バー ＋ メール ＋ ログアウト */}
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="Outliner" className="w-5 h-5 rounded-md border border-gray-200 flex-shrink-0" />
            <div className="flex-1 flex items-center bg-gray-100 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-gray-300 transition-shadow">
              <Search className="w-3.5 h-3.5 text-gray-500 mr-1.5 flex-shrink-0" />
              <input type="text" placeholder="検索..." className="w-full bg-transparent outline-none text-sm placeholder-gray-400"
                value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            </div>
            <span className="text-sm text-gray-500 hidden sm:block max-w-[220px] truncate flex-shrink-0" title={user.email || ''}>
              {user.email}
            </span>
            <button onClick={() => signOut(auth)} title="ログアウト"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0">
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* 2行目：フィルター ＋ 日付フィルター ＋ リロード */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* タスク状態フィルター */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg">
              <button onClick={() => setFilterMode('ALL')} title="すべて"
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${filterMode === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                <List size={16} />
              </button>
              <button onClick={() => setFilterMode('ACTIVE')} title="未完了"
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${filterMode === 'ACTIVE' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                <CircleDot size={16} />
              </button>
              <button onClick={() => setFilterMode('COMPLETED')} title="完了済み"
                className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${filterMode === 'COMPLETED' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                <CircleCheck size={16} />
              </button>
            </div>

            {/* 開始日フィルター */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg gap-0.5" title="開始日">
              <span className="text-[9px] text-gray-400 px-1.5 font-medium select-none">開始日</span>
              {([
                { key: 'START_TODAY',    icon: <CalendarDays size={16} />,   title: '開始: 今日' },
                { key: 'START_TOMORROW', icon: <CalendarCheck2 size={16} />, title: '開始: 明日' },
                { key: 'START_OVERDUE',  icon: <CalendarX2 size={16} />,    title: '開始: 期限切れ' },
              ] as const).map(({ key, icon, title }) => (
                <button key={key}
                  onClick={() => setFilterMode(filterMode === key ? 'ALL' : key)}
                  title={title}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${filterMode === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                  {icon}
                </button>
              ))}
            </div>

            {/* 終了日フィルター */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg gap-0.5" title="終了日">
              <span className="text-[9px] text-gray-400 px-1.5 font-medium select-none">終了日</span>
              {([
                { key: 'END_TODAY',    icon: <CalendarDays size={16} />,   title: '終了: 今日' },
                { key: 'END_TOMORROW', icon: <CalendarCheck2 size={16} />, title: '終了: 明日' },
                { key: 'END_OVERDUE',  icon: <CalendarX2 size={16} />,    title: '終了: 期限切れ' },
              ] as const).map(({ key, icon, title }) => (
                <button key={key}
                  onClick={() => setFilterMode(filterMode === key ? 'ALL' : key)}
                  title={title}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-all ${filterMode === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-700'}`}>
                  {icon}
                </button>
              ))}
            </div>

            <button onClick={() => window.location.reload()} title="再読み込み"
              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-8 pb-24">
        <div className="sm:min-w-[700px] pr-2 sm:pr-4">
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