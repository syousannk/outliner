import React, { useState, useReducer, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, ChevronDown, Circle, Search, Calendar, Plus, CheckCircle, Loader2 } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase 初期化 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- ユーティリティ ---
const generateId = () => crypto.randomUUID();

const createNode = (overrides = {}) => ({
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
const initialNodes = {
  'root': { id: 'root', children: ['node-1', 'node-2'], parent: null },
  'node-1': createNode({ id: 'node-1', text: 'プロジェクトのキックオフ', startDate: '2026-02-23', endDate: '2026-02-25' }),
  'node-2': createNode({ id: 'node-2', text: '機能要件の定義', children: ['node-3', 'node-4'] }),
  'node-3': createNode({ id: 'node-3', text: 'アウトライン機能の設計', parent: 'node-2' }),
  'node-4': createNode({ id: 'node-4', text: 'カレンダー機能の実装', parent: 'node-2', children: ['node-5'] }),
  'node-5': createNode({ id: 'node-5', text: '開始日・終了日の入力UI', parent: 'node-4' }),
};

const initialState = {
  nodes: initialNodes,
  focusId: null,
};

// --- 状態管理 Reducer ---
function reducer(state, action) {
  const nodes = { ...state.nodes };

  // ノードを安全に更新するためのクローン関数
  const clone = (id) => {
    nodes[id] = { ...nodes[id] };
    if (nodes[id].children) {
      nodes[id].children = [...nodes[id].children];
    }
    return nodes[id];
  };

  // 表示されているノードのフラットなリストを取得（上下移動・削除時のフォーカス用）
  const getVisibleList = () => {
    const list = [];
    const traverse = (id) => {
      if (id !== 'root') list.push(id);
      const n = nodes[id];
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
      clone(action.id).isCollapsed = !nodes[action.id].isCollapsed;
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
      } else {
        const parentId = nodes[afterId].parent;
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
      const node = nodes[id];
      const parentId = node.parent;
      
      const parent = clone(parentId);
      const index = parent.children.indexOf(id);
      if (index === 0) return state; // 最初の兄弟はインデント不可
      
      const prevSiblingId = parent.children[index - 1];
      
      // 最大5階層 (深さ4) までの制限
      let depth = 0;
      let curr = nodes[prevSiblingId];
      while (curr && curr.parent !== 'root') {
        depth++;
        curr = nodes[curr.parent];
      }
      if (depth >= 4) return state; 
      
      const prevSibling = clone(prevSiblingId);
      
      parent.children.splice(index, 1);
      prevSibling.children.push(id);
      prevSibling.isCollapsed = false; // インデントしたら親を展開する
      
      const clonedNode = clone(id);
      clonedNode.parent = prevSiblingId;
      
      return { ...state, nodes, focusId: id };
    }
    case 'UNINDENT': {
      const { id } = action;
      const node = nodes[id];
      const parentId = node.parent;
      if (parentId === 'root') return state; // これ以上アンインデント不可
      
      const parent = clone(parentId);
      const grandParentId = parent.parent;
      const grandParent = clone(grandParentId);
      
      const parentIndex = grandParent.children.indexOf(parentId);
      const nodeIndex = parent.children.indexOf(id);
      
      parent.children.splice(nodeIndex, 1);
      grandParent.children.splice(parentIndex + 1, 0, id);
      
      const clonedNode = clone(id);
      clonedNode.parent = grandParentId;
      
      return { ...state, nodes, focusId: id };
    }
    case 'DELETE': {
      const { id } = action;
      const node = nodes[id];
      
      // 子がいる場合は削除しない（安全のため）
      if (node.children.length > 0) return state;

      const parent = clone(node.parent);
      
      // ルート直下で最後の1つなら削除しない
      if (node.parent === 'root' && parent.children.length === 1 && node.text === '') {
        return state;
      }

      const list = getVisibleList();
      const idx = list.indexOf(id);
      const prevId = idx > 0 ? list[idx - 1] : null;

      parent.children = parent.children.filter(childId => childId !== id);
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
      clone(action.id).isCompleted = !nodes[action.id].isCompleted;
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
const useFilteredNodes = (nodes, searchQuery, filterMode) => {
  return useMemo(() => {
    const isFiltering = searchQuery !== "" || filterMode !== 'ALL';
    if (!isFiltering) return { isFiltering: false, matched: new Set() };
    
    const matched = new Set();
    const query = searchQuery ? searchQuery.toLowerCase() : "";

    // ボトムアップで「自身または子がマッチしたか」を判定
    const checkMatch = (id) => {
      if (id === 'root') {
        nodes[id].children.forEach(checkMatch);
        return false;
      }
      
      const node = nodes[id];
      const matchQuery = query ? node.text.toLowerCase().includes(query) : true;
      let matchFilter = true;
      
      if (filterMode === 'ACTIVE') matchFilter = !node.isCompleted;
      if (filterMode === 'COMPLETED') matchFilter = node.isCompleted;
      
      const selfMatch = matchQuery && matchFilter;
      
      let childMatch = false;
      node.children.forEach(childId => {
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

const Bullet = ({ hasChildren, isCollapsed, onToggle }) => (
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

const DateInput = ({ value, min, onChange, placeholder }) => (
  <input 
    type="date" 
    value={value} 
    min={min}
    onChange={onChange}
    className={`bg-transparent outline-none cursor-pointer w-[115px] text-xs sm:text-sm rounded px-1.5 py-1 hover:bg-gray-200 focus:ring-1 focus:ring-blue-400 transition-colors ${!value ? 'text-gray-400 opacity-60' : 'text-gray-700'}`}
    title={placeholder}
  />
);

const TreeItem = React.memo(({ id, nodes, dispatch, focusId, matched, isFiltering, searchQuery }) => {
  const node = nodes[id];
  const inputRef = useRef(null);
  
  useEffect(() => {
    if (focusId === id && inputRef.current) {
      inputRef.current.focus();
      // フォーカス時にカーソルを末尾へ
      setTimeout(() => {
        if (inputRef.current) {
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 0);
    }
  }, [focusId, id]);

  // フィルタリング中であり、このノード（またはその子孫）がマッチしていない場合は非表示
  if (isFiltering && !matched.has(id)) {
    return null;
  }

  const hasChildren = node.children.length > 0;
  // フィルタリング中は強制的に展開して表示
  const isExpanded = isFiltering ? true : !node.isCollapsed;
  const isHighlighted = searchQuery && node.text.toLowerCase().includes(searchQuery.toLowerCase());

  const isFocused = focusId === id;
  const hasDates = !!(node.startDate || node.endDate);
  const showCalendar = hasDates || isFocused;

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return; // IME変換中は無視

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) dispatch({ type: 'UNINDENT', id });
      else dispatch({ type: 'INDENT', id });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      dispatch({ type: 'ADD_NODE', afterId: id });
    } else if (e.key === 'Backspace') {
      if (node.text === '' && inputRef.current.selectionStart === 0) {
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
        
        {/* バレットアイコン */}
        <div className="flex-shrink-0">
          <Bullet 
            hasChildren={hasChildren} 
            isCollapsed={node.isCollapsed} 
            onToggle={() => dispatch({ type: 'TOGGLE_COLLAPSE', id })} 
          />
        </div>

        {/* 完了トグルボタン */}
        <button 
          onClick={() => dispatch({ type: 'TOGGLE_COMPLETE', id })}
          className={`flex-shrink-0 mx-1 flex items-center justify-center transition-colors ${node.isCompleted ? 'text-gray-400' : 'text-gray-300 hover:text-gray-400'}`}
          title={node.isCompleted ? "未完了にする" : "完了にする"}
        >
          {node.isCompleted ? <CheckCircle size={18} /> : <Circle size={18} />}
        </button>
        
        {/* メインコンテンツ（テキスト ＋ リーダー罫線 ＋ 日付） */}
        <div className={`flex-1 flex flex-row items-center ml-1 overflow-hidden transition-all duration-300 ${node.isCompleted ? 'opacity-40 grayscale' : 'opacity-100'}`}>
          {/* テキスト入力（文字幅に合わせて可変） */}
          <div className="relative flex-shrink overflow-hidden min-w-[20px]">
            <span className="invisible whitespace-pre block px-1 py-1 text-[15px] sm:text-base pointer-events-none">
              {node.text || 'タスクを入力'}
            </span>
            <input 
              ref={inputRef}
              value={node.text}
              onChange={e => dispatch({type: 'UPDATE_TEXT', id, text: e.target.value})}
              onFocus={() => {
                if (focusId !== id) dispatch({type: 'SET_FOCUS', id});
              }}
              onKeyDown={handleKeyDown}
              placeholder="タスクを入力"
              className={`absolute inset-0 w-full h-full bg-transparent outline-none py-1 text-[15px] sm:text-base transition-colors duration-300 ${isHighlighted ? 'bg-yellow-200/50 rounded px-1' : 'px-1'} ${node.isCompleted ? 'text-gray-500' : 'text-gray-900'}`}
            />
            {/* 左から右へ引かれる取り消し線 */}
            <div 
              className={`absolute top-1/2 left-1 -translate-y-1/2 h-[1.5px] bg-gray-500 transition-all duration-300 ease-out pointer-events-none ${node.isCompleted ? 'w-[calc(100%-8px)]' : 'w-0'}`}
            ></div>
          </div>

          {/* リーダー罫線（ライン接続） */}
          <div className="flex-1 border-t-[0.5px] border-solid border-gray-300 mx-2 min-w-[16px] transition-colors"></div>

          {/* カレンダー入力 */}
          <div className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 text-sm transition-opacity duration-200 ${showCalendar ? 'opacity-100' : 'opacity-0 focus-within:opacity-100'}`}>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <Calendar className="w-3.5 h-3.5 text-gray-400 ml-2" />
              <DateInput 
                value={node.startDate} 
                onChange={e => dispatch({type: 'UPDATE_DATES', id, field: 'startDate', value: e.target.value})}
                placeholder="開始日"
              />
            </div>
            <span className="text-gray-300">-</span>
            <div className="flex items-center bg-gray-50 rounded-md border border-gray-100 hover:border-gray-300 focus-within:border-blue-400 focus-within:bg-white transition-all overflow-hidden">
              <DateInput 
                min={node.startDate}
                value={node.endDate} 
                onChange={e => dispatch({type: 'UPDATE_DATES', id, field: 'endDate', value: e.target.value})}
                placeholder="終了日"
              />
            </div>
          </div>
        </div>

      </div>
      
      {/* 子ノードの再帰的レンダリングとツリーライン */}
      {isExpanded && hasChildren && (
        <div className="relative ml-[11px] pl-4 border-l-[0.5px] border-gray-300 transition-colors">
          {node.children.map(childId => (
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

// --- メインアプリケーション ---
export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL', 'ACTIVE', 'COMPLETED'
  const [title, setTitle] = useState("My Outline");

  // Firebase状態管理
  const [user, setUser] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const prevDataRef = useRef({ nodes: initialState.nodes, title: "My Outline" });

  // 1. 認証の初期化
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth error:", error);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Firestoreからデータを購読（ロード）
  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'outline', 'main');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const remoteData = docSnap.data();
        const remoteNodes = remoteData.nodes || initialNodes;
        const remoteTitle = remoteData.title || "My Outline";
        
        const currentRefData = prevDataRef.current;
        
        // 差分がある場合のみローカル状態を更新（無限ループ防止）
        if (JSON.stringify(remoteNodes) !== JSON.stringify(currentRefData.nodes) || remoteTitle !== currentRefData.title) {
          prevDataRef.current = { nodes: remoteNodes, title: remoteTitle };
          dispatch({ type: 'SET_NODES', nodes: remoteNodes });
          setTitle(remoteTitle);
        }
      } else {
        // 初回作成時
        setDoc(docRef, { nodes: initialNodes, title: "My Outline" });
      }
      setIsLoaded(true);
    }, (error) => {
      console.error("Firestore Sync Error:", error);
      setIsLoaded(true); // エラー時もローカルで利用できるようにする
    });

    return () => unsubscribe();
  }, [user]);

  // 3. ローカルの変更をFirestoreに保存
  useEffect(() => {
    if (!user || !isLoaded) return;
    const currentRefData = prevDataRef.current;
    
    // 状態が変わった場合のみ保存
    if (JSON.stringify(state.nodes) !== JSON.stringify(currentRefData.nodes) || title !== currentRefData.title) {
      prevDataRef.current = { nodes: state.nodes, title };
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'outline', 'main');
      setDoc(docRef, { nodes: state.nodes, title }, { merge: true });
    }
  }, [state.nodes, title, user, isLoaded]);

  const { isFiltering, matched } = useFilteredNodes(state.nodes, searchQuery, filterMode);

  // データロード中のスピナー表示
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-800 font-sans flex flex-col">
      
      {/* ヘッダー・検索バーとツールバー */}
      <header className="sticky top-0 bg-white/90 backdrop-blur-sm z-10 border-b border-gray-200 p-4 shadow-sm flex flex-col items-center">
        <div className="w-full max-w-5xl flex flex-col sm:flex-row items-center justify-between gap-4">
          
          {/* 検索バー */}
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

          {/* フィルターツールバー */}
          <div className="flex items-center bg-gray-100 p-1 rounded-lg flex-shrink-0">
            <button 
              onClick={() => setFilterMode('ALL')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filterMode === 'ALL' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              すべて
            </button>
            <button 
              onClick={() => setFilterMode('ACTIVE')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filterMode === 'ACTIVE' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              未完了
            </button>
            <button 
              onClick={() => setFilterMode('COMPLETED')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${filterMode === 'COMPLETED' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              完了済み
            </button>
          </div>

        </div>
      </header>
      
      {/* メインアウトライン領域 */}
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
              {state.nodes['root'].children.map(id => (
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
           
           {/* タスクが一つもない場合の追加ボタン */}
           {!isFiltering && state.nodes['root'].children.length === 0 && (
             <button 
               className="flex items-center text-gray-500 hover:text-gray-900 mt-4 px-2 py-1 rounded transition-colors hover:bg-gray-100"
               onClick={() => dispatch({type: 'ADD_NODE', isRoot: true})}
             >
               <Plus className="w-4 h-4 mr-2" /> タスクを追加
             </button>
           )}
         </div>
      </main>

    </div>
  );
}
