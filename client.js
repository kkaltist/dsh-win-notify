/**
 * DSH 桌面通知 —— 浏览器半身：只为在「插件 → dsh-win-notify」这个详情页里
 * 塞一块「提示音」设置，不弹任何常驻界面。
 *
 * 数据面全部走 shell 已有的 configForms 服务：
 *   读 = configForms.get(ns).getSnapshot()（Host 的 settings.describe 镜像）
 *   写 = 同一个 form 的 mutate([{op:'set', path:[...], value}])（带 revision 校验）
 * 选项不是写死的：从 Schema 序列化里把 sounds.* 那个 union 的 const 列表挖出来，
 * 所以 assets/sounds/ 里放了新音频、重启后这里自动多一项。
 */
window.__ModuleLoader__.load({
  id: 'dsh-win-notify',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useEffect, useMemo, useState } = React

    const NAMESPACE = 'win-notify'
    const FIELDS = [
      { key: 'turnEnd', label: '任务完成' },
      { key: 'approval', label: '需要授权' },
      { key: 'question', label: '模型提问' },
    ]
    const FALLBACK_OPTIONS = [
      { value: 'default', label: '系统通知音' },
      { value: 'exclamation', label: '系统提醒音' },
      { value: 'none', label: '静音' },
    ]

    // ── 小工具 ────────────────────────────────────────────────────────────
    const labelStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary)' }
    const hintStyle = { margin: 0, fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
    const selectStyle = {
      minWidth: 200,
      padding: '5px 8px',
      borderRadius: 7,
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
    }
    const sectionStyle = { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }

    /** 从 Schema 序列化（{uid, refs}）里取某一层 union 的可选值。 */
    function soundOptions(schemaJson, field) {
      try {
        const refs = schemaJson?.refs ?? {}
        const root = refs[schemaJson?.uid]
        const sounds = refs[root?.dict?.sounds]
        const node = refs[sounds?.dict?.[field]]
        const list = (node?.list ?? []).map(id => refs[id]).filter(Boolean)
        const options = list
          .filter(item => typeof item.value === 'string')
          .map(item => ({ value: item.value, label: item.meta?.description ?? item.value }))
        return options.length > 0 ? options : FALLBACK_OPTIONS
      } catch {
        return FALLBACK_OPTIONS
      }
    }

    function namespacesOf(mirror) {
      try {
        return mirror.getSnapshot()?.view?.namespaces ?? []
      } catch {
        return []
      }
    }

    /**
     * 认领我们自己的设置命名空间：先按 id 找，找不到就按 schema 里的特征字段找
     * （entry id 与包名不一定同名，不能赌）。
     */
    function pickNamespace(list) {
      if (!Array.isArray(list) || list.length === 0) return null
      const byId = list.find(item => item.ns === NAMESPACE) ?? list.find(item => String(item.ns).includes('win-notify'))
      if (byId) return byId
      const marker = JSON.stringify
      return list.find(item => marker(item.schema ?? {}).includes('skipWhenFocused')) ?? null
    }

    // ── 组件 ──────────────────────────────────────────────────────────────
    function SoundSettings({ subject, ctx }) {
      const mirror = useMemo(() => ctx.configForms.describe(), [ctx])
      const [rows, setRows] = useState(() => namespacesOf(mirror))

      // 关键：describe 这个镜像不会自己加载，必须 ensure() —— 少了这一步，
      // 命名空间永远是空数组，整块设置就静默不渲染（第一版就栽在这儿）。
      useEffect(() => {
        const sync = () => setRows(namespacesOf(mirror))
        try { mirror.ensure?.() } catch { /* 镜像自己会重试 */ }
        sync()
        const unsubscribe = mirror.subscribe?.(sync)
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [mirror])

      const namespace = useMemo(() => pickNamespace(rows), [rows])
      const namespaceId = namespace?.ns ?? ''
      const form = useMemo(() => (namespaceId === '' ? null : ctx.configForms.get(namespaceId)), [ctx, namespaceId])
      const [snapshot, setSnapshot] = useState(null)
      const [waited, setWaited] = useState(false)

      useEffect(() => {
        const timer = setTimeout(() => setWaited(true), 1500)
        return () => clearTimeout(timer)
      }, [])

      useEffect(() => {
        if (!form) return undefined
        const read = () => setSnapshot(form.getSnapshot())
        read()
        return form.subscribe(read)
      }, [form])

      const pkgName = String(subject?.pkg?.name ?? '')
      if (!pkgName.includes('win-notify')) return null
      if (!namespace || !snapshot || !snapshot.value) {
        // 镜像/命名空间还没到：先空着，1.5 秒还没来就给一行提示，别让人以为插件没生效
        if (!waited) return null
        return h('div', { style: sectionStyle },
          h('h3', { style: { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' } }, '提示音'),
          h('p', { style: hintStyle }, '设置还没就绪：确认插件已启用并重启过一次 DSH，然后刷新本页。'))
      }

      const value = snapshot.value ?? {}
      const sounds = value.sounds ?? {}
      const schemaJson = namespace.schema
      const disabled = snapshot.writable === false

      const write = (path, next) => {
        if (!form) return
        form.mutate([{ op: 'set', path, value: next }])
      }

      return h('div', { style: sectionStyle, 'data-plugin-config': true },
        h('h3', { style: { margin: 0, fontSize: 15, fontWeight: 600, lineHeight: '22px' } }, '提示音'),
        h('p', { style: hintStyle }, '三类通知可以各用各的声音。把 wav / mp3（≤10 秒）放进插件的 assets/sounds/ 后重启 DSH，这里会多出对应选项。'),
        ...FIELDS.map(field => h('label', {
          key: field.key,
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, maxWidth: 420 },
        },
        h('span', { style: labelStyle }, field.label),
        h('select', {
          style: { ...selectStyle, opacity: disabled ? 0.5 : 1 },
          value: sounds[field.key] ?? 'default',
          disabled,
          onChange: event => write(['sounds', field.key], event.target.value),
        }, ...soundOptions(schemaJson, field.key).map(option => h('option', {
          key: option.value,
          value: option.value,
        }, option.label))))),
        h('label', {
          style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, cursor: disabled ? 'default' : 'pointer' },
        },
        h('input', {
          type: 'checkbox',
          checked: value.skipWhenFocused !== false,
          disabled,
          onChange: event => write(['skipWhenFocused'], event.target.checked),
        }),
        h('span', { style: labelStyle }, 'DSH 在前台时不弹通知')))
    }

    // ── 插件 ──────────────────────────────────────────────────────────────
    function apply(ctx) {
      ctx.slots.inject('plugins.detail.section', () => ctx.slots.register({
        name: 'plugins.detail.section',
        id: 'win-notify-sounds',
        order: 30,
      }, props => h(SoundSettings, { subject: props.subject, ctx })))
    }

    exports.apply = apply
    exports.inject = ['slots', 'configForms']
    exports.name = 'win-notify'
    exports.__test = { soundOptions, pickNamespace, namespacesOf, SoundSettings }
    return module.exports
  },
})
