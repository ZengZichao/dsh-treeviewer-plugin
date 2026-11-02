/**
 * dsh-treeviewer — browser half.
 *
 * The panel is plain ESM-free JavaScript loaded by the dsh client-modules
 * protocol (window.__ModuleLoader__), so React comes from the page module table
 * and no build step ships a second React copy.
 *
 * It owns three things: the settings form (module selection + dynamic option
 * fields fed by the host introspection endpoint), the preview, and persistence
 * of the form in localStorage. All TreeViewer work happens in the host half.
 */

window.__ModuleLoader__.load({
  id: 'dsh-treeviewer',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-treeviewer'
    const API = '/api/treeviewer'
    const PANEL_ID = 'treeviewer'
    const STORAGE_KEY = 'dsh-treeviewer:settings@1'
    const PLOT_DEFAULTS = ['Branches', 'Labels']

    const DICT = {
      zh: {
        title: 'TreeViewer 出图',
        subtitle: '在本机用 TreeViewer 命令行渲染系统发育树',
        input: '树文件',
        inputPlaceholder: '例如 data/tree.nwk（相对路径按会话工作目录解析）',
        layout: '布局',
        format: '格式',
        width: '宽度 (px)',
        dpi: 'DPI',
        outputDir: '输出目录',
        outputDirPlaceholder: '留空则写入插件工作目录',
        style: '样式',
        branchWidth: '枝宽',
        labelFont: '标签字体',
        bootstrap: '显示支持值',
        modules: '模块',
        coordinates: '坐标模块',
        plotActions: '绘制动作',
        render: '出图',
        rendering: '正在出图…',
        auto: '修改后自动预览',
        preview: '预览',
        empty: '设置好参数后点击“出图”。',
        settings: '本次使用的设置',
        applied: '已应用的设置',
        error: '出图失败',
        ready: 'TreeViewer',
        notReady: 'TreeViewer 不可用',
        noOptions: '该模块没有可调参数。',
        complex: '复杂参数需在 TreeViewer 中编辑',
        notImage: '该格式不生成对话预览，请打开文件查看。',
        open: '打开文件',
        loading: '加载中…',
        retry: '重新检测',
      },
      en: {
        title: 'TreeViewer render',
        subtitle: 'Render phylogenetic trees on this machine with TreeViewer',
        input: 'Tree file',
        inputPlaceholder: 'e.g. data/tree.nwk (relative paths use the session working directory)',
        layout: 'Layout',
        format: 'Format',
        width: 'Width (px)',
        dpi: 'DPI',
        outputDir: 'Output directory',
        outputDirPlaceholder: 'Empty writes into the plugin work directory',
        style: 'Style',
        branchWidth: 'Branch width',
        labelFont: 'Label font',
        bootstrap: 'Show support values',
        modules: 'Modules',
        coordinates: 'Coordinates',
        plotActions: 'Plot actions',
        render: 'Render',
        rendering: 'Rendering…',
        auto: 'Auto preview after changes',
        preview: 'Preview',
        empty: 'Set the options, then press Render.',
        settings: 'Settings sent',
        applied: 'Applied settings',
        error: 'Render failed',
        ready: 'TreeViewer',
        notReady: 'TreeViewer is not available',
        noOptions: 'This module has no configurable options.',
        complex: 'Edit this option inside TreeViewer',
        notImage: 'This format has no chat preview; open the file instead.',
        open: 'Open file',
        loading: 'Loading…',
        retry: 'Check again',
      },
    }

    const lang = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) ? 'zh' : 'en'
    const t = (key) => DICT[lang][key] ?? DICT.en[key] ?? key

    const DEFAULTS = {
      inputFile: '',
      format: 'png',
      coordinatesModule: 'Rectangular',
      plotActions: PLOT_DEFAULTS,
      width: 900,
      dpi: '',
      outputDir: '',
      branchWidth: '',
      labelFont: 'Helvetica 10',
      showBootstrap: false,
      autoPreview: true,
      options: {},
    }

    function loadForm() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return { ...DEFAULTS }
        const parsed = JSON.parse(raw)
        return { ...DEFAULTS, ...parsed, options: parsed.options && typeof parsed.options === 'object' ? parsed.options : {} }
      } catch {
        return { ...DEFAULTS }
      }
    }

    function saveForm(form) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(form))
      } catch {
        /* storage disabled */
      }
    }

    async function api(path, options) {
      const response = await fetch(`${API}${path}`, {
        headers: { 'content-type': 'application/json' },
        ...options,
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || (payload && payload.ok === false)) {
        const error = (payload && payload.error) || { message: `HTTP ${response.status}` }
        const failure = new Error(error.message || 'request failed')
        failure.code = error.code
        failure.hint = error.hint
        throw failure
      }
      return payload
    }

    function moduleParameters(schema, overrides) {
      const parameters = {}
      for (const parameter of schema) {
        if (parameter.type === 'complex' || parameter.type === 'unknown') continue
        const value = overrides[parameter.label]
        if (value === undefined) continue
        parameters[parameter.label] = value
      }
      return parameters
    }

    function bootstrapLayer(form) {
      const parameters = { Attribute: 'Support', 'Show on': 'Internal nodes' }
      if (form.labelFont) parameters.Font = form.labelFont
      return parameters
    }

    function buildSettings(form) {
      const coordinatesOptions = (form.options && form.options[form.coordinatesModule]) || {}
      const plotActions = form.plotActions.map((module) => ({
        module,
        parameters: moduleParameters(((form.schemas || {})[module]) || [], (form.options && form.options[module]) || {}),
      }))
      if (form.showBootstrap) plotActions.push({ module: 'Labels', parameters: bootstrapLayer(form) })
      const presets = {}
      if (form.branchWidth !== '' && form.branchWidth !== null) presets.branchWidth = Number(form.branchWidth)
      if (form.labelFont) presets.labelFont = form.labelFont
      const output = { format: form.format }
      if (form.outputDir) output.path = `${form.outputDir.replace(/[\\/]+$/, '')}/treeviewer-preview.${form.format}`
      if ((form.format === 'png' || form.format === 'tiff') && Number(form.width) > 0) output.width = Number(form.width)
      if (form.dpi !== '' && Number(form.dpi) > 0) output.dpi = Number(form.dpi)
      return {
        inputFile: form.inputFile,
        output,
        presets,
        pipeline: {
          Coordinates: { module: form.coordinatesModule, parameters: moduleParameters(((form.schemas || {})[form.coordinatesModule]) || [], coordinatesOptions) },
          'Plot action': plotActions,
        },
      }
    }

    function Field(props) {
      return h('label', { className: 'tv-field' },
        h('span', { className: 'tv-field-label' }, props.label),
        props.children)
    }

    function OptionField({ parameter, value, onChange }) {
      const current = value === undefined ? parameter.value : value
      if (parameter.type === 'boolean') {
        return h('label', { className: 'tv-check' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(current),
            onChange: (event) => onChange(event.target.checked),
          }),
          h('span', null, parameter.label))
      }
      if (parameter.type === 'complex' || parameter.type === 'unknown') {
        return h('div', { className: 'tv-option tv-option-complex', title: t('complex') },
          h('span', { className: 'tv-option-name' }, parameter.label),
          h('span', { className: 'tv-option-value' }, String(parameter.value)))
      }
      if (parameter.type === 'enum' && Array.isArray(parameter.enumValues) && parameter.enumValues.length > 0) {
        return h(Field, { label: parameter.label },
          h('select', {
            value: String(current),
            onChange: (event) => onChange(event.target.value),
          }, parameter.enumValues.map((option) => h('option', { key: option, value: option }, option))))
      }
      if (parameter.type === 'color') {
        return h(Field, { label: parameter.label },
          h('input', {
            type: 'color',
            value: /^#[0-9a-f]{6}$/i.test(String(current)) ? String(current) : '#000000',
            onChange: (event) => onChange(event.target.value.toUpperCase()),
          }))
      }
      if (parameter.type === 'number') {
        return h(Field, { label: parameter.label },
          h('input', {
            type: 'number',
            value: current === null || current === undefined ? '' : String(current),
            step: 'any',
            ...(parameter.min === undefined ? {} : { min: parameter.min }),
            ...(parameter.max === undefined ? {} : { max: parameter.max }),
            onChange: (event) => onChange(event.target.value === '' ? '' : Number(event.target.value)),
          }))
      }
      return h(Field, { label: parameter.label },
        h('input', {
          type: 'text',
          value: current === null || current === undefined ? '' : String(current),
          ...(parameter.syntaxHint ? { title: parameter.syntaxHint } : {}),
          onChange: (event) => onChange(event.target.value),
        }))
    }

    function ModuleOptions({ form, module, schemas, onOption }) {
      const schema = schemas[module]
      if (!schema) return h('div', { className: 'tv-hint' }, t('loading'))
      if (schema.length === 0) return h('div', { className: 'tv-hint' }, t('noOptions'))
      const overrides = (form.options && form.options[module]) || {}
      return h('div', { className: 'tv-options' },
        schema.map((parameter) => h(OptionField, {
          key: `${module}:${parameter.label}`,
          parameter,
          value: overrides[parameter.label],
          onChange: (value) => onOption(module, parameter.label, value),
        })))
    }

    function StatusBanner({ status, error, onRetry }) {
      if (error) {
        return h('div', { className: 'tv-banner tv-banner-error' },
          h('strong', null, t('error')), ' ',
          h('span', null, `${error.code ? `[${error.code}] ` : ''}${error.message}`),
          error.hint ? h('div', { className: 'tv-hint' }, error.hint) : null,
          h('button', { type: 'button', className: 'tv-link', onClick: onRetry }, t('retry')))
      }
      if (!status) return h('div', { className: 'tv-banner' }, t('loading'))
      if (!status.ok) {
        return h('div', { className: 'tv-banner tv-banner-error' },
          h('strong', null, t('notReady')), ' ',
          h('span', null, status.error?.message || ''),
          status.error?.hint ? h('div', { className: 'tv-hint' }, status.error.hint) : null,
          h('button', { type: 'button', className: 'tv-link', onClick: onRetry }, t('retry')))
      }
      return h('div', { className: 'tv-banner tv-banner-ok' },
        h('span', null, `${t('ready')} ${status.version?.treeviewer ?? ''} (CLI ${status.version?.commandLine ?? ''})`),
        h('span', { className: 'tv-banner-path', title: status.cli?.path }, status.cli?.path || ''))
    }

    function TreeViewerPanel() {
      const [form, setForm] = React.useState(loadForm)
      const [status, setStatus] = React.useState(null)
      const [catalog, setCatalog] = React.useState(null)
      const [schemas, setSchemas] = React.useState({})
      const [preview, setPreview] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const [showSettings, setShowSettings] = React.useState(false)
      const timer = React.useRef(null)
      const latest = React.useRef(form)
      const busyRef = React.useRef(false)

      latest.current = { ...form, schemas }
      React.useEffect(() => { saveForm(form) }, [form])

      const loadStatus = React.useCallback(async () => {
        try {
          const next = await api('/status')
          setStatus(next)
          if (next.ok) {
            const modules = await api('/modules')
            setCatalog(modules)
          }
        } catch (failure) {
          setStatus({ ok: false, error: { code: failure.code, message: failure.message, hint: failure.hint } })
        }
      }, [])

      React.useEffect(() => { loadStatus() }, [loadStatus])

      const ensureSchema = React.useCallback(async (category, module) => {
        if (!module || schemas[module]) return
        try {
          const result = await api(`/options?category=${encodeURIComponent(category)}&module=${encodeURIComponent(module)}`)
          setSchemas((current) => ({ ...current, [module]: result.parameters }))
        } catch {
          setSchemas((current) => ({ ...current, [module]: [] }))
        }
      }, [schemas])

      React.useEffect(() => {
        if (!catalog) return
        ensureSchema('Coordinates', form.coordinatesModule)
        for (const module of form.plotActions) ensureSchema('Plot action', module)
      }, [catalog, form.coordinatesModule, form.plotActions.join('|'), ensureSchema])

      const update = (patch) => setForm((current) => ({ ...current, ...patch }))

      const setOption = (module, label, value) => {
        setForm((current) => ({
          ...current,
          options: { ...current.options, [module]: { ...(current.options[module] || {}), [label]: value } },
        }))
      }

      const doRender = React.useCallback(async () => {
        const state = latest.current
        if (!state.inputFile || busyRef.current) return
        busyRef.current = true
        setBusy(true)
        setError(null)
        try {
          const payload = await api('/render', { method: 'POST', body: JSON.stringify({ settings: buildSettings(state) }) })
          setPreview({ ...payload, at: Date.now() })
        } catch (failure) {
          setError({ code: failure.code, message: failure.message, hint: failure.hint })
        } finally {
          busyRef.current = false
          setBusy(false)
        }
      })

      const schedule = React.useCallback(() => {
        if (!latest.current.autoPreview) return
        clearTimeout(timer.current)
        timer.current = setTimeout(() => { doRender() }, 900)
      }, [doRender])

      React.useEffect(() => () => clearTimeout(timer.current), [])

      const coordinates = catalog?.categories?.Coordinates?.map((module) => module.name) || ['Rectangular', 'Circular', 'Radial']
      const plotModules = catalog?.categories?.['Plot action'] || []
      const plotNames = plotModules.length > 0 ? plotModules.map((module) => module.name) : PLOT_DEFAULTS

      const toggleAction = (name, checked) => {
        const next = checked ? [...form.plotActions, name] : form.plotActions.filter((item) => item !== name)
        update({ plotActions: next })
        schedule()
      }

      const imageUrl = preview ? `${preview.imageUrl}${preview.imageUrl.includes('?') ? '&' : '?'}t=${preview.at}` : null
      const isPreviewable = preview && (preview.format === 'png' || preview.format === 'svg')

      return h('div', { className: 'tv-root' },
        h('header', { className: 'tv-header' },
          h('div', null,
            h('h1', { className: 'tv-title' }, t('title')),
            h('p', { className: 'tv-subtitle' }, t('subtitle'))),
          h('button', {
            type: 'button',
            className: 'tv-primary',
            disabled: busy || !status?.ok || !form.inputFile,
            onClick: () => doRender(),
          }, busy ? t('rendering') : t('render'))),

        h(StatusBanner, { status, error, onRetry: loadStatus }),

        h('div', { className: 'tv-body' },
          h('section', { className: 'tv-form', 'aria-label': t('settings') },
            h('div', { className: 'tv-group' },
              h(Field, { label: t('input') },
                h('input', {
                  type: 'text',
                  value: form.inputFile,
                  placeholder: t('inputPlaceholder'),
                  onChange: (event) => update({ inputFile: event.target.value }),
                  onBlur: schedule,
                })),
              h('div', { className: 'tv-row' },
                h(Field, { label: t('layout') },
                  h('select', {
                    value: form.coordinatesModule,
                    onChange: (event) => { update({ coordinatesModule: event.target.value }); schedule() },
                  }, coordinates.map((name) => h('option', { key: name, value: name }, name)))),
                h(Field, { label: t('format') },
                  h('select', {
                    value: form.format,
                    onChange: (event) => { update({ format: event.target.value }); schedule() },
                  }, ['png', 'svg', 'pdf', 'tiff'].map((format) => h('option', { key: format, value: format }, format.toUpperCase()))))),
              h('div', { className: 'tv-row' },
                h(Field, { label: t('width') },
                  h('input', {
                    type: 'number', min: 16, step: 10, value: String(form.width),
                    onChange: (event) => update({ width: event.target.value }),
                    onBlur: schedule,
                  })),
                h(Field, { label: t('dpi') },
                  h('input', {
                    type: 'number', min: 1, step: 1, value: String(form.dpi),
                    onChange: (event) => update({ dpi: event.target.value }),
                    onBlur: schedule,
                  }))),
              h(Field, { label: t('outputDir') },
                h('input', {
                  type: 'text',
                  value: form.outputDir,
                  placeholder: t('outputDirPlaceholder'),
                  onChange: (event) => update({ outputDir: event.target.value }),
                  onBlur: schedule,
                }))),

            h('div', { className: 'tv-group' },
              h('h2', { className: 'tv-group-title' }, t('style')),
              h('div', { className: 'tv-row' },
                h(Field, { label: t('branchWidth') },
                  h('input', {
                    type: 'number', min: 0, step: 0.5, value: String(form.branchWidth),
                    onChange: (event) => update({ branchWidth: event.target.value }),
                    onBlur: schedule,
                  })),
                h(Field, { label: t('labelFont') },
                  h('input', {
                    type: 'text', value: form.labelFont, placeholder: 'Helvetica 10',
                    onChange: (event) => update({ labelFont: event.target.value }),
                    onBlur: schedule,
                  }))),
              h('label', { className: 'tv-check' },
                h('input', {
                  type: 'checkbox', checked: form.showBootstrap,
                  onChange: (event) => { update({ showBootstrap: event.target.checked }); schedule() },
                }),
                h('span', null, t('bootstrap'))),
              h('label', { className: 'tv-check' },
                h('input', {
                  type: 'checkbox', checked: form.autoPreview,
                  onChange: (event) => update({ autoPreview: event.target.checked }),
                }),
                h('span', null, t('auto')))),

            h('div', { className: 'tv-group' },
              h('h2', { className: 'tv-group-title' }, t('modules')),
              h('div', { className: 'tv-module-block' },
                h('div', { className: 'tv-module-name' }, `${t('coordinates')}: ${form.coordinatesModule}`),
                h(ModuleOptions, {
                  form, module: form.coordinatesModule, schemas,
                  onOption: (module, label, value) => { setOption(module, label, value); schedule() },
                })),
              h('div', { className: 'tv-module-block' },
                h('div', { className: 'tv-module-name' }, t('plotActions')),
                h('div', { className: 'tv-check-grid' },
                  plotNames.map((name) => h('label', { key: name, className: 'tv-check' },
                    h('input', {
                      type: 'checkbox',
                      checked: form.plotActions.includes(name),
                      onChange: (event) => toggleAction(name, event.target.checked),
                    }),
                    h('span', null, name)))),
                form.plotActions.map((module) => h('div', { key: `options:${module}`, className: 'tv-module-block tv-module-nested' },
                  h('div', { className: 'tv-module-name' }, module),
                  h(ModuleOptions, {
                    form, module, schemas,
                    onOption: (name, label, value) => { setOption(name, label, value); schedule() },
                  })))))),

          h('section', { className: 'tv-preview', 'aria-label': t('preview') },
            h('div', { className: 'tv-preview-head' },
              h('span', null, preview ? `${preview.format.toUpperCase()} · ${preview.width ?? '?'}×${preview.height ?? '?'} px · ${Math.round(preview.bytes / 1024)} KB · ${preview.durationMs} ms` : t('preview')),
              preview ? h('a', { className: 'tv-link', href: preview.imageUrl, target: '_blank', rel: 'noreferrer' }, t('open')) : null),
            h('div', { className: 'tv-preview-body' },
              !preview ? h('div', { className: 'tv-empty' }, t('empty'))
                : isPreviewable
                  ? h('img', { className: 'tv-image', src: imageUrl, alt: t('title') })
                  : h('div', { className: 'tv-empty' }, t('notImage')),
              busy ? h('div', { className: 'tv-spinner' }, t('rendering')) : null),
            preview ? h('div', { className: 'tv-applied' },
              h('button', { type: 'button', className: 'tv-link', onClick: () => setShowSettings((value) => !value) },
                `${t('applied')} ${showSettings ? '▾' : '▸'}`),
              showSettings ? h('pre', { className: 'tv-json' }, JSON.stringify(preview.appliedSettings, null, 2)) : null) : null)))
    }

    function TreeViewerIcon() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true' },
        h('path', { d: 'M12 3v5M12 8c0 3-6 3-6 6v2M12 8c0 3 6 3 6 6v2', strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 3, r: 1.6 }),
        h('circle', { cx: 6, cy: 18, r: 1.6 }),
        h('circle', { cx: 18, cy: 18, r: 1.6 }))
    }

    const CSS = `
.tv-root { display: flex; flex-direction: column; height: 100%; min-height: 0; gap: 10px; padding: 14px; box-sizing: border-box; color: inherit; }
.tv-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.tv-title { font-size: 16px; font-weight: 600; margin: 0; }
.tv-subtitle { margin: 2px 0 0; font-size: 12px; opacity: .68; }
.tv-banner { font-size: 12px; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(127,127,127,.28); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tv-banner-ok { border-color: rgba(46,160,67,.45); }
.tv-banner-error { border-color: rgba(220,80,80,.55); }
.tv-banner-path { opacity: .6; font-family: ui-monospace, monospace; word-break: break-all; }
.tv-body { display: flex; gap: 14px; flex: 1; min-height: 0; }
.tv-form { width: 360px; min-width: 300px; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
.tv-preview { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; border: 1px solid rgba(127,127,127,.25); border-radius: 10px; padding: 10px; min-height: 0; }
.tv-preview-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; opacity: .8; }
.tv-preview-body { flex: 1; min-height: 240px; display: flex; align-items: center; justify-content: center; overflow: auto; background: rgba(127,127,127,.06); border-radius: 8px; position: relative; }
.tv-image { max-width: 100%; max-height: 100%; object-fit: contain; background: #fff; }
.tv-empty { font-size: 13px; opacity: .6; padding: 24px; text-align: center; }
.tv-spinner { position: absolute; inset: auto 10px 10px auto; font-size: 12px; background: rgba(0,0,0,.55); color: #fff; padding: 4px 8px; border-radius: 6px; }
.tv-group { border: 1px solid rgba(127,127,127,.22); border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.tv-group-title { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; opacity: .65; margin: 0; }
.tv-row { display: flex; gap: 8px; }
.tv-row > * { flex: 1; min-width: 0; }
.tv-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.tv-field-label { opacity: .72; }
.tv-field input, .tv-field select { width: 100%; box-sizing: border-box; padding: 5px 7px; border-radius: 6px; border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; font: inherit; font-size: 12px; }
.tv-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
.tv-check-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 4px 8px; }
.tv-module-block { display: flex; flex-direction: column; gap: 6px; }
.tv-module-nested { margin-top: 6px; padding-top: 6px; border-top: 1px dashed rgba(127,127,127,.25); }
.tv-module-name { font-size: 12px; font-weight: 600; opacity: .85; }
.tv-options { display: flex; flex-direction: column; gap: 6px; }
.tv-option { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; opacity: .55; }
.tv-option-value { font-family: ui-monospace, monospace; }
.tv-hint { font-size: 11px; opacity: .55; }
.tv-primary { padding: 7px 16px; border-radius: 8px; border: 1px solid rgba(127,127,127,.4); background: transparent; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
.tv-primary:disabled { opacity: .45; cursor: not-allowed; }
.tv-link { background: none; border: none; padding: 0 4px; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; font-size: 12px; }
.tv-applied { font-size: 12px; }
.tv-json { max-height: 220px; overflow: auto; font-size: 11px; background: rgba(127,127,127,.08); padding: 8px; border-radius: 6px; margin: 6px 0 0; }
@media (max-width: 900px) { .tv-body { flex-direction: column; } .tv-form { width: auto; } }
`

    function installStyle(ctx) {
      const style = document.createElement('style')
      style.setAttribute('data-dsh-treeviewer', '')
      style.textContent = CSS
      document.head.appendChild(style)
      if (typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          if (style.parentNode) style.parentNode.removeChild(style)
        }, 'dsh-treeviewer: styles')
      }
    }

    function apply(ctx) {
      installStyle(ctx)
      const slots = ctx.get?.('slots') ?? ctx.slots
      if (!slots || typeof slots.inject !== 'function') return
      slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, TreeViewerPanel))
      slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 120,
        label: () => t('title'),
        locale: NS,
      }, TreeViewerIcon))
    }

    return {
      name: 'dsh-treeviewer-client',
      inject: ['slots'],
      apply,
    }
  },
})
