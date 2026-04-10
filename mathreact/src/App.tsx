import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'

type ChapterNode = {
  id: number
  parent_id?: number | null
  chapter_name: string
  count: number
}

type RawChoice = {
  choice_id: string
  choice: string
  is_answer: boolean
}

type RawQuestion = {
  id: number
  question_id: string
  chapter_id: number
  difficulty: string
  accuracy_rate?: number
  difficulty_score?: number
  avg_time_spent?: number
  tags?: string
  answer: string
  question: string
  analysis: string
  analysis_image?: string
  ai_tags?: string
  choices: RawChoice[]
}

type RawPage = {
  data?: {
    questions?: RawQuestion[]
  }
}

type TreePayload = {
  data?: {
    data?: ChapterNode[]
  }
}

type UiChapter = {
  id: number
  name: string
  count: number
}

type ChapterTreeNode = {
  id: number
  name: string
  count: number
  isLeaf: boolean
  selectable: boolean
  children: ChapterTreeNode[]
}

type ViewMode = 'chapter' | 'favorites'
type ThemeMode = 'light' | 'dark'
type HardTag = 'mistake' | 'slow' | 'high'
type SortMode = 'default' | 'accuracy-asc' | 'difficulty-desc' | 'difficulty-asc'

const QUESTIONS_PER_PAGE = 10
const FAVORITES_STORAGE_KEY = 'mathreact:favorites'
const THEME_STORAGE_KEY = 'mathreact:theme'
const PROGRESS_STORAGE_KEY = 'mathreact:progress'
const LOW_ACCURACY_THRESHOLD = 0.67
const LONG_TIME_THRESHOLD = 121711
const HIGH_DIFFICULTY_THRESHOLD = 0.43
const HARD_TAG_META: Record<HardTag, { label: string; chipClass: string }> = {
  mistake: { label: 'L1 易错题', chipClass: 'hard-mistake' },
  slow: { label: 'L2 耗时题', chipClass: 'hard-slow' },
  high: { label: 'L3 高难题', chipClass: 'hard-high' },
}
const HARD_TAG_ORDER: HardTag[] = ['mistake', 'slow', 'high']

function loadTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') {
    return stored
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function loadFavorites(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw) as Record<string, boolean>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadProgress(): { chapterId: number | null; pageIndex: number } {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY)
    if (!raw) {
      return { chapterId: null, pageIndex: 0 }
    }
    const parsed = JSON.parse(raw)
    return {
      chapterId: typeof parsed.chapterId === 'number' ? parsed.chapterId : null,
      pageIndex: typeof parsed.pageIndex === 'number' ? parsed.pageIndex : 0,
    }
  } catch {
    return { chapterId: null, pageIndex: 0 }
  }
}

function MarkdownMath({ text }: { text: string }) {
  // 将短划线 \bar 替换为全宽的 \overline（包括 \bar{A} 和 \bar A，以及两层 \bar{\bar{A}}）
  // 这样渲染逻辑非、集合补集等「a的反」时会更好看。
  const prettierText = text.replace(/\\bar(?![a-zA-Z])/g, '\\overline')

  return (
    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
      {prettierText}
    </ReactMarkdown>
  )
}

function formatRate(rate?: number): string {
  if (rate == null || Number.isNaN(rate)) {
    return '--'
  }
  return `${(rate * 100).toFixed(0)}%`
}

function formatDifficultyScore(score?: number): string {
  if (score == null || Number.isNaN(score)) {
    return '--'
  }
  return score.toFixed(2)
}

function formatAvgTimeSpent(time?: number): string {
  if (time == null || Number.isNaN(time)) {
    return '--'
  }
  if (time >= 1000) {
    return `${(time / 1000).toFixed(1)}s`
  }
  return `${time}ms`
}

function shouldUseSingleColumnChoices(choices: RawChoice[]): boolean {
  return choices.some((choice) => {
    const compact = choice.choice
      .replace(/\$\$?/g, '')
      .replace(/\\[a-zA-Z]+/g, '')
      .replace(/\s+/g, '')

    return compact.length > 30 || choice.choice.includes('\n') || choice.choice.includes('$$')
  })
}

function getChoiceLabel(choiceId: string, index: number): string {
  const normalized = choiceId.trim().toUpperCase()
  if (normalized.length === 1 && normalized >= 'A' && normalized <= 'Z') {
    return normalized
  }

  // 数字型 choice_id（如 "1","2","3","4"）不能直接换算字母，
  // 因为洗牌后位置已变，必须用渲染索引来决定 A/B/C/D。
  return String.fromCharCode(65 + index)
}

function getHardTags(question: RawQuestion): HardTag[] {
  const tags: HardTag[] = []

  if (
    question.accuracy_rate != null &&
    Number.isFinite(question.accuracy_rate) &&
    question.accuracy_rate <= LOW_ACCURACY_THRESHOLD
  ) {
    tags.push('mistake')
  }

  if (
    question.avg_time_spent != null &&
    Number.isFinite(question.avg_time_spent) &&
    question.avg_time_spent >= LONG_TIME_THRESHOLD
  ) {
    tags.push('slow')
  }

  if (
    question.difficulty_score != null &&
    Number.isFinite(question.difficulty_score) &&
    question.difficulty_score >= HIGH_DIFFICULTY_THRESHOLD
  ) {
    tags.push('high')
  }

  return tags
}

function normalizeAnalysisText(text: string): string {
  const splitAligned = (_whole: string, inner: string): string => {
    const lines = inner
      .split(/\\\\\s*/)
      .map((line) =>
        line
          .replace(/^\s*&\s*/, '')
          .replace(/&/g, '')
          .trim(),
      )
      .filter(Boolean)

    if (lines.length === 0) {
      return _whole
    }

    // 将超宽 aligned 公式拆成多个独立公式块，避免单行过长产生难以拖动的横条。
    return lines.map((line) => `$$\n${line}\n$$`).join('\n\n')
  }

  // 优先匹配带 $$ 包裹的 aligned，避免产生双层 $$ 导致不渲染。
  const replacedWithBlock = text.replace(
    /\$\$\s*\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}\s*\$\$/g,
    splitAligned,
  )

  // 兜底处理未被 $$ 包裹的 aligned。
  return replacedWithBlock.replace(/\\begin\{aligned\}([\s\S]*?)\\end\{aligned\}/g, splitAligned)
}

function getCorrectAnswerLabel(question: RawQuestion): string {
  const matchedIndex = question.choices.findIndex((choice) => choice.choice_id === question.answer)
  if (matchedIndex >= 0) {
    return getChoiceLabel(question.choices[matchedIndex].choice_id, matchedIndex)
  }

  const answerByFlagIndex = question.choices.findIndex((choice) => choice.is_answer)
  if (answerByFlagIndex >= 0) {
    return getChoiceLabel(question.choices[answerByFlagIndex].choice_id, answerByFlagIndex)
  }

  return question.answer.trim()
}

function shuffleChoices(questions: RawQuestion[]): RawQuestion[] {
  return questions.map((question) => {
    const choices = [...question.choices]
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]]
    }
    return { ...question, choices }
  })
}

function getFullImageUrl(url?: string): string {
  if (!url) return ''
  if (url.startsWith('/')) {
    return `https://mathreact.local${url}`
  }
  return url
}

function getLeafChapters(nodes: ChapterNode[]): UiChapter[] {
  const parentSet = new Set(
    nodes.filter((node) => node.parent_id != null).map((node) => node.parent_id as number),
  )

  return nodes
    .filter((node) => !parentSet.has(node.id))
    .filter((node) => node.count > 0)
    .filter((node) => node.id >= 256 && node.id <= 400)
    .sort((a, b) => a.id - b.id)
    .map((node) => ({
      id: node.id,
      name: node.chapter_name,
      count: node.count,
    }))
}

function buildChapterTree(nodes: ChapterNode[], selectableLeafIds: Set<number>): ChapterTreeNode[] {
  const nodeMap = new Map<number, ChapterNode>()
  nodes.forEach((node) => nodeMap.set(node.id, node))

  const included = new Set<number>()

  selectableLeafIds.forEach((leafId) => {
    let cursor = nodeMap.get(leafId)
    while (cursor) {
      if (included.has(cursor.id)) {
        break
      }
      included.add(cursor.id)
      if (cursor.parent_id == null) {
        break
      }
      cursor = nodeMap.get(cursor.parent_id)
    }
  })

  const childrenMap = new Map<number, number[]>()
  included.forEach((id) => childrenMap.set(id, []))

  included.forEach((id) => {
    const node = nodeMap.get(id)
    if (!node || node.parent_id == null) {
      return
    }
    if (included.has(node.parent_id)) {
      childrenMap.get(node.parent_id)?.push(id)
    }
  })

  childrenMap.forEach((list) => list.sort((a, b) => a - b))

  let roots = Array.from(included).filter((id) => {
    const node = nodeMap.get(id)
    if (!node || node.parent_id == null) {
      return true
    }
    return !included.has(node.parent_id)
  })

  roots = roots.sort((a, b) => a - b)

  const toTree = (id: number): ChapterTreeNode => {
    const node = nodeMap.get(id)!
    const childIds = childrenMap.get(id) ?? []
    return {
      id: node.id,
      name: node.chapter_name,
      count: node.count,
      isLeaf: childIds.length === 0,
      selectable: selectableLeafIds.has(node.id),
      children: childIds.map(toTree),
    }
  }

  let tree = roots.map(toTree)

  // 目录通常有一层“学科根节点”，这里直接展开到章节层，方便左侧直接看到 1/2/3... 结构。
  if (tree.length === 1 && !tree[0].isLeaf) {
    tree = tree[0].children
  }

  return tree
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadTheme())
  const [viewMode, setViewMode] = useState<ViewMode>('chapter')
  const [chapters, setChapters] = useState<UiChapter[]>([])
  const [chapterTree, setChapterTree] = useState<ChapterTreeNode[]>([])
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({})
  const [chapterId, setChapterId] = useState<number | null>(() => loadProgress().chapterId)
  const [allAnalysisOpen, setAllAnalysisOpen] = useState(false)
  const [allAnswerOpen, setAllAnswerOpen] = useState(false)
  const [questions, setQuestions] = useState<RawQuestion[]>([])
  const [allQuestions, setAllQuestions] = useState<RawQuestion[]>([])
  const [pageIndex, setPageIndex] = useState(() => loadProgress().pageIndex)
  const [selectedChoices, setSelectedChoices] = useState<Record<string, string>>({})
  const [analysisOpenMap, setAnalysisOpenMap] = useState<Record<string, boolean>>({})
  const [favoriteMap, setFavoriteMap] = useState<Record<string, boolean>>(() => loadFavorites())
  const [selectedHardTags, setSelectedHardTags] = useState<Record<HardTag, boolean>>({
    mistake: false,
    slow: false,
    high: false,
  })
  const [sortMode, setSortMode] = useState<SortMode>('default')
  const [onlyFavorites, setOnlyFavorites] = useState(false)
  const [loading, setLoading] = useState(false)
  const [favoritesLoading, setFavoritesLoading] = useState(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode)
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  }, [themeMode])

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteMap))
  }, [favoriteMap])

  useEffect(() => {
    localStorage.setItem(
      PROGRESS_STORAGE_KEY,
      JSON.stringify({ chapterId, pageIndex })
    )
  }, [chapterId, pageIndex])

  useEffect(() => {
    const run = async () => {
      try {
        setError('')
        const res = await fetch('/data/meta/neumathe_chapter_tree.json')
        if (!res.ok) {
          throw new Error('目录树文件读取失败')
        }
        const payload = (await res.json()) as TreePayload
        const nodes = payload.data?.data ?? []
        const leafChapters = getLeafChapters(nodes)
        const leafIdSet = new Set(leafChapters.map((chapter) => chapter.id))
        const tree = buildChapterTree(nodes, leafIdSet)

        setChapters(leafChapters)
        setChapterTree(tree)
        setExpandedIds({})

        if (leafChapters.length > 0 && chapterId === null) {
          setChapterId(leafChapters[0].id)
        }
      } catch {
        setError('加载目录失败，请确认 public/data/meta 下有 neumathe_chapter_tree.json')
      }
    }

    void run()
  }, [])

  useEffect(() => {
    if (chapterId == null) {
      return
    }

    const run = async () => {
      try {
        setLoading(true)
        setError('')
        const res = await fetch(`/data/chapters/neumathe_chapter_${chapterId}_raw.json`)
        if (!res.ok) {
          throw new Error('章节题库读取失败')
        }
        const payload = (await res.json()) as RawPage[]
        const mergedQuestions = shuffleChoices(payload.flatMap((page) => page.data?.questions ?? []))
        setQuestions(mergedQuestions)
        // 只有当切换了章节时才归零页码（如果刷新页面，chapterId相同则保留pageIndex）
        const lastProgress = loadProgress()
        if (lastProgress.chapterId !== chapterId) {
          setPageIndex(0)
        }
        setSelectedChoices({})
        setAnalysisOpenMap({})
      } catch {
        setQuestions([])
        setError(`加载章节 ${chapterId} 失败，请确认对应 raw 文件已复制`)
      } finally {
        setLoading(false)
      }
    }

    void run()
  }, [chapterId])

  useEffect(() => {
    if (viewMode !== 'favorites' || allQuestions.length > 0 || chapters.length === 0) {
      return
    }

    let cancelled = false

    const run = async () => {
      try {
        setFavoritesLoading(true)
        setError('')
        const batches = await Promise.all(
          chapters.map(async (chapter) => {
            try {
              const res = await fetch(`/data/chapters/neumathe_chapter_${chapter.id}_raw.json`)
              if (!res.ok) {
                return [] as RawQuestion[]
              }
              const payload = (await res.json()) as RawPage[]
              return shuffleChoices(payload.flatMap((page) => page.data?.questions ?? []))
            } catch {
              return [] as RawQuestion[]
            }
          }),
        )

        if (!cancelled) {
          setAllQuestions(batches.flat())
        }
      } catch {
        if (!cancelled) {
          setError('加载收藏题夹失败，请稍后重试')
        }
      } finally {
        if (!cancelled) {
          setFavoritesLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [viewMode, allQuestions.length, chapters])

  const questionSource = useMemo(() => {
    return viewMode === 'favorites' ? allQuestions : questions
  }, [viewMode, allQuestions, questions])

  const activeHardTagSet = useMemo(() => {
    return new Set(
      HARD_TAG_ORDER.filter((tag) => selectedHardTags[tag]),
    )
  }, [selectedHardTags])

  const displayQuestions = useMemo(() => {
    const baseQuestions =
      viewMode === 'favorites'
        ? questionSource.filter((question) => favoriteMap[question.question_id])
        : onlyFavorites
          ? questionSource.filter((question) => favoriteMap[question.question_id])
          : questionSource

    if (activeHardTagSet.size === 0) {
      return baseQuestions
    }

    return baseQuestions.filter((question) => {
      const hardTags = getHardTags(question)
      return hardTags.some((tag) => activeHardTagSet.has(tag))
    })
  }, [viewMode, questionSource, favoriteMap, onlyFavorites, activeHardTagSet])

  const sortedQuestions = useMemo(() => {
    if (sortMode === 'default') {
      return displayQuestions
    }

    const copy = [...displayQuestions]
    if (sortMode === 'accuracy-asc') {
      return copy.sort((a, b) => (a.accuracy_rate ?? 1) - (b.accuracy_rate ?? 1))
    }
    if (sortMode === 'difficulty-desc') {
      return copy.sort((a, b) => (b.difficulty_score ?? 0) - (a.difficulty_score ?? 0))
    }
    if (sortMode === 'difficulty-asc') {
      return copy.sort((a, b) => (a.difficulty_score ?? 0) - (b.difficulty_score ?? 0))
    }
    return copy
  }, [displayQuestions, sortMode])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedQuestions.length / QUESTIONS_PER_PAGE)),
    [sortedQuestions.length],
  )

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(sortedQuestions.length / QUESTIONS_PER_PAGE) - 1)
    if (pageIndex > maxPage) {
      setPageIndex(0)
    }
  }, [sortedQuestions.length, pageIndex])

  const pageQuestions = useMemo(() => {
    const start = pageIndex * QUESTIONS_PER_PAGE
    const end = start + QUESTIONS_PER_PAGE
    return sortedQuestions.slice(start, end)
  }, [sortedQuestions, pageIndex])

  const selectedChapterLabel = useMemo(() => {
    if (viewMode === 'favorites') {
      return '收藏题夹（跨章节）'
    }
    if (chapterId == null) {
      return ''
    }
    const found = chapters.find((chapter) => chapter.id === chapterId)
    return found ? `${found.id} · ${found.name}` : ''
  }, [viewMode, chapterId, chapters])

  const favoritesInChapter = useMemo(
    () => questions.filter((question) => favoriteMap[question.question_id]).length,
    [questions, favoriteMap],
  )

  const favoriteTotal = useMemo(
    () => Object.values(favoriteMap).filter(Boolean).length,
    [favoriteMap],
  )

  const chapterNameById = useMemo(() => {
    return new Map(chapters.map((chapter) => [chapter.id, chapter.name]))
  }, [chapters])

  const movePage = (direction: -1 | 1) => {
    const nextPage = pageIndex + direction
    if (nextPage < 0 || nextPage >= totalPages) {
      return
    }
    setPageIndex(nextPage)
  }

  const toggleTreeNode = (id: number) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  const renderTreeNode = (node: ChapterTreeNode, depth = 0): React.ReactNode => {
    const expanded = expandedIds[node.id] ?? false
    const isActive = node.selectable && chapterId === node.id

    return (
      <li key={node.id} className="tree-item">
        <button
          type="button"
          className={`tree-button ${node.isLeaf ? 'leaf' : 'branch'} ${isActive ? 'active' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 10}px` }}
          onClick={() => {
            if (node.isLeaf && node.selectable) {
              setViewMode('chapter')
              setChapterId(node.id)
              setPageIndex(0)
              setError('')
              return
            }
            toggleTreeNode(node.id)
          }}
        >
          {!node.isLeaf && <span className="tree-arrow">{expanded ? '▾' : '▸'}</span>}
          {node.isLeaf && <span className="tree-dot">•</span>}
          <span className="tree-label">{node.name}</span>
          <span className="tree-count">{node.count}</span>
        </button>

        {!node.isLeaf && expanded && (
          <ul className="tree-list">
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="kicker">mathreact 练习站</p>
        <h1>概率统计 256-400 章节练习</h1>
        <p className="sub">章节覆盖以目录树叶子节点为准，数据来自本地题库文件。</p>
      </header>

      <main className="layout">
        <section className="panel settings-panel">
          <h2>练习设置</h2>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allAnalysisOpen}
              onChange={(e) => setAllAnalysisOpen(e.target.checked)}
              disabled={displayQuestions.length === 0}
            />
            <span>解析全部展开</span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allAnswerOpen}
              onChange={(e) => setAllAnswerOpen(e.target.checked)}
              disabled={displayQuestions.length === 0}
            />
            <span>展开答案</span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={themeMode === 'dark'}
              onChange={(e) => setThemeMode(e.target.checked ? 'dark' : 'light')}
            />
            <span>暗夜模式</span>
          </label>

          <div className="field">
            <span>题目排序方式</span>
            <select
              className="sort-select"
              value={sortMode}
              onChange={(e) => {
                setSortMode(e.target.value as SortMode)
                setPageIndex(0)
              }}
            >
              <option value="default">默认顺序</option>
              <option value="accuracy-asc">正确率：从低到高</option>
              <option value="difficulty-desc">难度：从高到低</option>
              <option value="difficulty-asc">难度：从低到高</option>
            </select>
          </div>

          <div className="field">
            <span>难题等级筛选（勾选后只显示对应题目）</span>
            <div className="hard-filter-grid">
              {HARD_TAG_ORDER.map((tag) => {
                const meta = HARD_TAG_META[tag]

                return (
                  <label
                    key={tag}
                    className={`hard-filter-item ${selectedHardTags[tag] ? 'active' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedHardTags[tag]}
                      onChange={(e) => {
                        setSelectedHardTags((prev) => ({
                          ...prev,
                          [tag]: e.target.checked,
                        }))
                        setPageIndex(0)
                      }}
                    />
                    <span>{meta.label}</span>
                  </label>
                )
              })}
            </div>
          </div>

          <div className="folder-switch">
            <button
              type="button"
              className={`folder-btn ${viewMode === 'chapter' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('chapter')
                setPageIndex(0)
                setError('')
              }}
            >
              章节题库
            </button>
            <button
              type="button"
              className={`folder-btn ${viewMode === 'favorites' ? 'active' : ''}`}
              onClick={() => {
                setViewMode('favorites')
                setPageIndex(0)
                setError('')
              }}
            >
              收藏题夹
            </button>
          </div>

          <div className="field">
            <span>选择章节（树形目录，默认收起）</span>
            <div className="chapter-tree-wrap">
              {chapterTree.length > 0 ? (
                <ul className="tree-list">{chapterTree.map((node) => renderTreeNode(node))}</ul>
              ) : (
                <p className="hint">章节目录加载中...</p>
              )}
            </div>
          </div>

          {viewMode === 'favorites' && (
            <p className="folder-tip">收藏题夹会汇总不同章节的收藏题，统一刷题。</p>
          )}

          {viewMode === 'chapter' && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={onlyFavorites}
                onChange={(e) => {
                  setOnlyFavorites(e.target.checked)
                  setPageIndex(0)
                }}
              />
              <span>只看收藏题</span>
            </label>
          )}

          <div className="chapter-meta">
            <div>可练章节：{chapters.length}</div>
            <div>当前题量：{questionSource.length}</div>
            <div>筛选后题量：{sortedQuestions.length}</div>
            <div>收藏总数：{favoriteTotal}</div>
            {viewMode === 'chapter' && <div>当前章节收藏：{favoritesInChapter}</div>}
            <div>每页题量：{QUESTIONS_PER_PAGE}</div>
            {selectedChapterLabel && <div>当前章节：{selectedChapterLabel}</div>}
          </div>
        </section>

        <section className="panel question-panel">
          {(viewMode === 'chapter' ? loading : favoritesLoading) && (
            <p className="hint">
              {viewMode === 'chapter' ? '正在加载章节题目...' : '正在汇总收藏题夹...'}
            </p>
          )}
          {!!error && <p className="error">{error}</p>}

          {!(viewMode === 'chapter' ? loading : favoritesLoading) && !error && pageQuestions.length > 0 && (
            <>
              <div className="page-toolbar">
                <span className="badge">第 {pageIndex + 1} / {totalPages} 页</span>
                <span className="badge subtle">
                  {viewMode === 'favorites'
                    ? `收藏题夹本页 ${pageQuestions.length} 题`
                    : `本页 ${pageQuestions.length} 题，可上下滚动`}
                </span>
                <button type="button" onClick={() => movePage(-1)} disabled={pageIndex === 0}>
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => movePage(1)}
                  disabled={pageIndex === totalPages - 1}
                >
                  下一页
                </button>
              </div>

              <div className="question-list">
                {pageQuestions.map((question, index) => {
                  const key = question.question_id
                  const selectedChoice = selectedChoices[key] ?? ''
                  const hasSelected = selectedChoice !== ''
                  const isCorrect = hasSelected && selectedChoice === question.answer
                  const isAnalysisOpen = allAnalysisOpen || analysisOpenMap[key] === true
                  const isFavorite = favoriteMap[key] === true
                  const correctAnswerLabel = getCorrectAnswerLabel(question)
                  const hardTags = getHardTags(question)
                  const chapterName = chapterNameById.get(question.chapter_id) ?? `章节 ${question.chapter_id}`
                  const globalNo = pageIndex * QUESTIONS_PER_PAGE + index + 1
                  const useSingleColumnChoices = shouldUseSingleColumnChoices(question.choices)

                  return (
                    <article key={key} className="question-card">
                      <div className="question-head">
                        <span className="question-index-circle">{globalNo}</span>
                        <div className="question-stats">
                          <span className="stat-chip icon-chip accuracy-chip" title="正确率">
                            {formatRate(question.accuracy_rate)}
                          </span>
                          <span className="stat-chip icon-chip difficulty-chip" title="难度分">
                            {formatDifficultyScore(question.difficulty_score)}
                          </span>
                          <span className="stat-chip icon-chip time-chip" title="平均用时">
                            {formatAvgTimeSpent(question.avg_time_spent)}
                          </span>
                          {hardTags.map((tag) => {
                            const meta = HARD_TAG_META[tag]
                            return (
                              <span
                                key={`${key}-${tag}`}
                                className={`stat-chip hard-tag-chip ${meta.chipClass}`}
                              >
                                {meta.label}
                              </span>
                            )
                          })}
                          {question.tags && <span className="stat-chip hot-tag-chip">{question.tags}</span>}
                        </div>
                        {viewMode === 'favorites' && (
                          <span className="badge chapter">章节：{question.chapter_id} · {chapterName}</span>
                        )}
                      </div>

                      <div className="question-body markdown-body">
                        <MarkdownMath text={question.question} />
                      </div>

                      <div className={`choices ${useSingleColumnChoices ? 'one-col' : 'two-col'}`}>
                        {question.choices.map((choice, choiceIndex) => {
                          const checked = selectedChoice === choice.choice_id
                          const showRight = checked && choice.choice_id === question.answer
                          const showWrong = checked && choice.choice_id !== question.answer
                          const choiceLabel = getChoiceLabel(choice.choice_id, choiceIndex)

                          return (
                            <label
                              key={choice.choice_id}
                              className={`choice ${checked ? 'selected' : ''} ${showRight ? 'right' : ''} ${showWrong ? 'wrong' : ''}`}
                            >
                              <input
                                type="radio"
                                name={`choice-${key}`}
                                value={choice.choice_id}
                                checked={checked}
                                onChange={() =>
                                  setSelectedChoices((prev) => ({
                                    ...prev,
                                    [key]: choice.choice_id,
                                  }))
                                }
                              />
                              <span className="choice-id">{choiceLabel}.</span>
                              <span className="markdown-body">
                                <MarkdownMath text={choice.choice} />
                              </span>
                            </label>
                          )
                        })}
                      </div>

                      <div className="toolbar">
                        <button
                          type="button"
                          className="analysis-toggle"
                          disabled={allAnalysisOpen}
                          onClick={() =>
                            setAnalysisOpenMap((prev) => ({
                              ...prev,
                              [key]: !prev[key],
                            }))
                          }
                        >
                          {allAnalysisOpen ? '已全部展开' : isAnalysisOpen ? '收起解析' : '展开解析'}
                        </button>
                        <button
                          type="button"
                          className={`favorite-toggle ${isFavorite ? 'active' : ''}`}
                          onClick={() =>
                            setFavoriteMap((prev) => ({
                              ...prev,
                              [key]: !prev[key],
                            }))
                          }
                        >
                          {isFavorite ? '★ 已收藏' : '☆ 收藏'}
                        </button>
                      </div>

                      {hasSelected && (
                        <p className={`judge ${isCorrect ? 'ok' : 'bad'}`}>
                          {isCorrect ? '回答正确' : '回答错误'}
                        </p>
                      )}

                      {allAnswerOpen && (
                        <div className="answer-line markdown-body">
                          正确答案：<MarkdownMath text={correctAnswerLabel} />
                        </div>
                      )}

                      {isAnalysisOpen && (
                        <section className="analysis markdown-body">
                          <h3>题目解析</h3>
                          <MarkdownMath text={normalizeAnalysisText(question.analysis || '暂无解析')} />
                          {question.analysis_image && (
                            <div className="analysis-image-container">
                              <p className="image-hint">参考解析图：</p>
                              <img
                                src={getFullImageUrl(question.analysis_image)}
                                alt="解析图片"
                                className="analysis-img"
                                loading="lazy"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none'
                                }}
                              />
                              <a
                                href={getFullImageUrl(question.analysis_image)}
                                target="_blank"
                                rel="noreferrer"
                                className="image-link"
                              >
                                查看原图
                              </a>
                            </div>
                          )}
                        </section>
                      )}
                    </article>
                  )
                })}
              </div>

              <div className="page-toolbar bottom">
                <span className="badge">第 {pageIndex + 1} / {totalPages} 页</span>
                <button type="button" onClick={() => movePage(-1)} disabled={pageIndex === 0}>
                  上一页
                </button>
                <button
                  type="button"
                  onClick={() => movePage(1)}
                  disabled={pageIndex === totalPages - 1}
                >
                  下一页
                </button>
              </div>
            </>
          )}

          {!(viewMode === 'chapter' ? loading : favoritesLoading) && !error && pageQuestions.length === 0 && (
            <p className="hint">
              {viewMode === 'favorites' ? '收藏题夹暂无题目，请先在题目中点击收藏。' : '当前章节暂无可用题目。'}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
