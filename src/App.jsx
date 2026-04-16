import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Color Utilities ─────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return r ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) } : null
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('')
}
function colorDistance(a, b) {
  const ra = hexToRgb(a), rb = hexToRgb(b)
  if (!ra || !rb) return 999
  return Math.sqrt((ra.r-rb.r)**2 + (ra.g-rb.g)**2 + (ra.b-rb.b)**2)
}
function normalizeColor(color) {
  if (!color) return null
  color = color.trim()
  if (!color || color==='none' || color==='transparent' || color==='inherit' || color==='currentColor') return null
  if (color.startsWith('#')) {
    const c = color.toLowerCase()
    if (c.length===4) return '#'+c[1]+c[1]+c[2]+c[2]+c[3]+c[3]
    if (c.length===7) return c
    return null
  }
  const rgb = color.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
  if (rgb) return rgbToHex(parseInt(rgb[1]),parseInt(rgb[2]),parseInt(rgb[3]))
  try {
    const c = document.createElement('canvas'); c.width=c.height=1
    const ctx = c.getContext('2d'); ctx.fillStyle=color; ctx.fillRect(0,0,1,1)
    const [r,g,b,a] = ctx.getImageData(0,0,1,1).data
    if (a===0) return null
    return rgbToHex(r,g,b)
  } catch { return null }
}
function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') }

// ─── SVG Utilities ────────────────────────────────────────────────────────────
function extractSVGColors(svgString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString,'image/svg+xml')
  const colors = new Set()
  const add = c => { const n=normalizeColor(c); if(n) colors.add(n) }
  doc.querySelectorAll('*').forEach(el => {
    add(el.getAttribute('fill')); add(el.getAttribute('stroke'))
    add(el.getAttribute('stop-color')); add(el.getAttribute('flood-color'))
    const style = el.getAttribute('style')
    if (style) [...style.matchAll(/(?:fill|stroke|stop-color|color)\s*:\s*([^;]+)/gi)].forEach(m=>add(m[1].trim()))
  })
  doc.querySelectorAll('style').forEach(el => {
    [...el.textContent.matchAll(/(?:fill|stroke|stop-color|color)\s*:\s*([^;}\s]+)/gi)].forEach(m=>add(m[1].trim()))
  })
  return [...colors]
}
function replaceSVGColor(svgString, fromHex, toHex) {
  const f = fromHex.toLowerCase()
  const variants = new Set([f, f.toUpperCase(), fromHex])
  const short = f.match(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/)
  if (short) { const s='#'+short[1]+short[2]+short[3]; variants.add(s); variants.add(s.toUpperCase()) }
  let result = svgString
  variants.forEach(v => {
    const e = escapeRegex(v)
    result = result.replace(new RegExp(`(fill|stroke|stop-color|flood-color|color)=["'](${e})["']`,'gi'),(_,attr)=>`${attr}="${toHex}"`)
    result = result.replace(new RegExp(`(fill|stroke|stop-color|color)\\s*:\\s*${e}`,'gi'),(_,attr)=>`${attr}:${toHex}`)
  })
  return result
}
function getElementColor(el) {
  if (!el || el.tagName==='svg') return null
  const fill = el.getAttribute('fill')
  if (fill && fill!=='none') return normalizeColor(fill)
  const style = el.getAttribute('style')
  if (style) { const m=style.match(/fill\s*:\s*([^;]+)/); if(m) return normalizeColor(m[1].trim()) }
  const computed = window.getComputedStyle(el).fill
  if (computed && computed!=='none') return normalizeColor(computed)
  return null
}

// ─── Background Removal ───────────────────────────────────────────────────────
function removeSVGBackground(svgString) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString,'image/svg+xml')
  const svg = doc.querySelector('svg')
  if (!svg) return svgString
  const vb = (svg.getAttribute('viewBox')||'').split(/[\s,]+/).map(Number)
  const svgW = parseFloat(svg.getAttribute('width')||vb[2]||0)
  const svgH = parseFloat(svg.getAttribute('height')||vb[3]||0)
  for (const el of [...svg.children]) {
    if (el.tagName!=='rect') continue
    const x=parseFloat(el.getAttribute('x')||'0'), y=parseFloat(el.getAttribute('y')||'0')
    const w=el.getAttribute('width')||'0', h=el.getAttribute('height')||'0'
    const fillsW = w==='100%'||(svgW>0&&parseFloat(w)>=svgW*0.88)
    const fillsH = h==='100%'||(svgH>0&&parseFloat(h)>=svgH*0.88)
    if (x<=0&&y<=0&&(fillsW||fillsH)) { el.remove(); break }
  }
  svg.setAttribute('style',(svg.getAttribute('style')||'')+'; background: transparent;')
  return new XMLSerializer().serializeToString(doc)
}
function removeRasterBackground(canvas, tolerance) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const imgData = ctx.getImageData(0,0,width,height)
  const data = imgData.data
  const bgR=data[0], bgG=data[1], bgB=data[2]
  const visited = new Uint8Array(width*height)
  const stack = [0, width-1, width*(height-1), width*height-1]
  while (stack.length) {
    const idx = stack.pop()
    if (idx<0||idx>=width*height||visited[idx]) continue
    visited[idx]=1
    const pi=idx*4
    const dr=data[pi]-bgR, dg=data[pi+1]-bgG, db=data[pi+2]-bgB
    if (Math.sqrt(dr*dr+dg*dg+db*db)<=tolerance) {
      data[pi+3]=0
      const x=idx%width, y=Math.floor(idx/width)
      if(x>0) stack.push(idx-1)
      if(x<width-1) stack.push(idx+1)
      if(y>0) stack.push(idx-width)
      if(y<height-1) stack.push(idx+width)
    }
  }
  ctx.putImageData(imgData,0,0)
}

// ─── Canvas Utilities ─────────────────────────────────────────────────────────
function sampleImageColors(imageData) {
  const data = imageData.data, counts = {}
  for (let i=0; i<data.length; i+=4*3) {
    if (data[i+3]<128) continue
    const hex = rgbToHex(data[i],data[i+1],data[i+2])
    counts[hex]=(counts[hex]||0)+1
  }
  const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([h])=>h)
  const result = []
  for (const color of sorted) {
    if (!result.some(e=>colorDistance(color,e)<35)) result.push(color)
    if (result.length>=14) break
  }
  return result
}
function replaceRasterColor(canvas, fromHex, toHex, tolerance) {
  const ctx = canvas.getContext('2d')
  const imgData = ctx.getImageData(0,0,canvas.width,canvas.height)
  const data = imgData.data
  const from=hexToRgb(fromHex), to=hexToRgb(toHex)
  if (!from||!to) return
  for (let i=0; i<data.length; i+=4) {
    const d=Math.sqrt((data[i]-from.r)**2+(data[i+1]-from.g)**2+(data[i+2]-from.b)**2)
    if (d<=tolerance) { data[i]=to.r; data[i+1]=to.g; data[i+2]=to.b }
  }
  ctx.putImageData(imgData,0,0)
}

// ─── Color Merging ────────────────────────────────────────────────────────────
function findSimilarGroups(colors, threshold) {
  const groups=[], assigned=new Set()
  for (const c of colors) {
    if (assigned.has(c)) continue
    const group=[c]; assigned.add(c)
    for (const o of colors) {
      if (!assigned.has(o)&&colorDistance(c,o)<=threshold) { group.push(o); assigned.add(o) }
    }
    if (group.length>1) groups.push(group)
  }
  return groups
}

// ─── Crisp Lines ─────────────────────────────────────────────────────────────
function sharpenCanvas(canvas) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const src = ctx.getImageData(0, 0, width, height)
  const dst = ctx.createImageData(width, height)
  const s = src.data, d = dst.data
  for (let y = 1; y < height-1; y++) {
    for (let x = 1; x < width-1; x++) {
      const i = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const center = s[i+c]
        const avg = (s[i-4+c] + s[i+4+c] + s[i-width*4+c] + s[i+width*4+c]) / 4
        d[i+c] = Math.max(0, Math.min(255, Math.round(center + (center - avg) * 2.0)))
      }
      d[i+3] = s[i+3]
    }
  }
  for (let i = 0; i < d.length; i+=4) {
    const x=(i/4)%width, y=Math.floor((i/4)/width)
    if (y===0||y===height-1||x===0||x===width-1) { d[i]=s[i];d[i+1]=s[i+1];d[i+2]=s[i+2];d[i+3]=s[i+3] }
  }
  ctx.putImageData(dst, 0, 0)
}
function snapAlphaCanvas(canvas, threshold) {
  const ctx = canvas.getContext('2d')
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imgData.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 0 && data[i+3] < 255) {
      data[i+3] = data[i+3] >= threshold ? 255 : 0
    }
  }
  ctx.putImageData(imgData, 0, 0)
}

// ─── Color Swatch ─────────────────────────────────────────────────────────────
function ColorSwatch({ color, selected, onClick, size=42 }) {
  const rgb = hexToRgb(color)||{r:0,g:0,b:0}
  const isLight = (0.299*rgb.r+0.587*rgb.g+0.114*rgb.b)/255 > 0.85
  return (
    <button className={`color-swatch ${selected?'selected':''} ${isLight?'light':''}`}
      style={{ background:color, width:size, height:size }}
      onClick={onClick} title={color} aria-label={`Select color ${color}`}>
      {selected && <span className="swatch-check">✓</span>}
    </button>
  )
}

// ─── Eyedropper Icon ──────────────────────────────────────────────────────────
function EyedropperIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 11l-8-8-9 9 5 5 1-1 3 3h4l1-4 3-4z"/>
      <circle cx="6.5" cy="17.5" r="2.5"/>
    </svg>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [file, setFile] = useState(null)
  const [fileType, setFileType] = useState(null)
  const [svgContent, setSvgContent] = useState(null)
  const [previewSvg, setPreviewSvg] = useState(null)
  const [colors, setColors] = useState([])
  const [selectedColor, setSelectedColor] = useState(null)
  const [replacementColor, setReplacementColor] = useState('#ff0000')
  const [replacements, setReplacements] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [tolerance, setTolerance] = useState(25)
  const [hint, setHint] = useState(null)
  // Cleanup
  const [bgTolerance, setBgTolerance] = useState(30)
  const [mergeTolerance, setMergeTolerance] = useState(20)
  const [similarGroups, setSimilarGroups] = useState([])
  const [crispThreshold, setCrispThreshold] = useState(128)
  // Pixel edit
  const [showPixelEdit, setShowPixelEdit] = useState(false)
  const [zoomLevel, setZoomLevel] = useState(8)
  const [zoomCenter, setZoomCenter] = useState({ x: 0, y: 0 })
  const [paintColor, setPaintColor] = useState('#ffffff')
  const [eyedropperMode, setEyedropperMode] = useState(null) // null | 'replace' | 'paint'
  const isPaintingRef = useRef(false)

  const canvasRef = useRef(null)
  const origCanvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const svgContainerRef = useRef(null)
  const zoomCanvasRef = useRef(null)

  useEffect(() => {
    if (!hint) return
    const t = setTimeout(()=>setHint(null),3500)
    return ()=>clearTimeout(t)
  }, [hint])

  useEffect(() => {
    setSimilarGroups(findSimilarGroups(colors, mergeTolerance))
  }, [colors, mergeTolerance])

  // ── Zoom render ──
  const renderZoom = useCallback(() => {
    const canvas = canvasRef.current
    const zc = zoomCanvasRef.current
    if (!canvas || !zc || canvas.width===0 || canvas.height===0) return
    const { width: cw, height: ch } = canvas
    const ZW = zc.width, ZH = zc.height
    const cellsX = Math.floor(ZW / zoomLevel)
    const cellsY = Math.floor(ZH / zoomLevel)
    const sx = Math.max(0, Math.min(zoomCenter.x - Math.floor(cellsX/2), cw - cellsX))
    const sy = Math.max(0, Math.min(zoomCenter.y - Math.floor(cellsY/2), ch - cellsY))
    const ctx = zc.getContext('2d')
    // Checker background for transparency
    for (let gy = 0; gy < ZH; gy += 10) {
      for (let gx = 0; gx < ZW; gx += 10) {
        ctx.fillStyle = ((gx/10 + gy/10) % 2 === 0) ? '#1d1d25' : '#141418'
        ctx.fillRect(gx, gy, 10, 10)
      }
    }
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(canvas, sx, sy, cellsX, cellsY, 0, 0, ZW, ZH)
    // Pixel grid
    if (zoomLevel >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = 0.5
      for (let x = 0; x <= ZW; x += zoomLevel) {
        ctx.beginPath(); ctx.moveTo(x+0.5, 0); ctx.lineTo(x+0.5, ZH); ctx.stroke()
      }
      for (let y = 0; y <= ZH; y += zoomLevel) {
        ctx.beginPath(); ctx.moveTo(0, y+0.5); ctx.lineTo(ZW, y+0.5); ctx.stroke()
      }
    }
  }, [zoomLevel, zoomCenter])

  useEffect(() => {
    if (fileType === 'raster' && showPixelEdit) renderZoom()
  }, [zoomLevel, zoomCenter, showPixelEdit, fileType, renderZoom])

  // ── Get pixel coords from zoom canvas event ──
  const getZoomPixel = useCallback((e) => {
    const canvas = canvasRef.current
    const zc = zoomCanvasRef.current
    if (!canvas || !zc) return null
    const ZW = zc.width, ZH = zc.height
    const rect = zc.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * ZW / rect.width
    const my = (e.clientY - rect.top) * ZH / rect.height
    const cellsX = Math.floor(ZW / zoomLevel)
    const cellsY = Math.floor(ZH / zoomLevel)
    const sx = Math.max(0, Math.min(zoomCenter.x - Math.floor(cellsX/2), canvas.width - cellsX))
    const sy = Math.max(0, Math.min(zoomCenter.y - Math.floor(cellsY/2), canvas.height - cellsY))
    const px = Math.floor(mx / zoomLevel) + sx
    const py = Math.floor(my / zoomLevel) + sy
    if (px < 0 || px >= canvas.width || py < 0 || py >= canvas.height) return null
    return { px, py }
  }, [zoomLevel, zoomCenter])

  // ── Paint on zoom canvas ──
  const paintPixel = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const pixel = getZoomPixel(e)
    if (!pixel) return
    const ctx = canvas.getContext('2d')
    const rgb = hexToRgb(paintColor)
    if (!rgb) return
    const imgData = ctx.getImageData(pixel.px, pixel.py, 1, 1)
    imgData.data[0] = rgb.r; imgData.data[1] = rgb.g; imgData.data[2] = rgb.b; imgData.data[3] = 255
    ctx.putImageData(imgData, pixel.px, pixel.py)
    renderZoom()
  }, [getZoomPixel, paintColor, renderZoom])

  // ── File loading ──
  const handleFile = useCallback((f) => {
    if (!f) return
    setFile(f); setReplacements([]); setSelectedColor(null); setShowPixelEdit(false)
    const ext = f.name.split('.').pop().toLowerCase()
    if (ext==='svg'||f.type==='image/svg+xml') {
      setFileType('svg')
      const reader = new FileReader()
      reader.onload = e => {
        const content = e.target.result
        setSvgContent(content); setPreviewSvg(content)
        const extracted = extractSVGColors(content)
        setColors(extracted)
        if (extracted.length>0) setReplacementColor(extracted[0])
      }
      reader.readAsText(f)
    } else {
      setFileType('raster'); setSvgContent(null); setPreviewSvg(null)
      const url = URL.createObjectURL(f)
      const img = new Image()
      img.onload = () => {
        const canvas=canvasRef.current, orig=origCanvasRef.current
        if(!canvas||!orig) return
        canvas.width=orig.width=img.width; canvas.height=orig.height=img.height
        canvas.getContext('2d').drawImage(img,0,0); orig.getContext('2d').drawImage(img,0,0)
        const imgData = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)
        const sampled = sampleImageColors(imgData)
        setColors(sampled)
        if(sampled.length>0) setReplacementColor(sampled[0])
        setZoomCenter({ x: Math.floor(img.width/2), y: Math.floor(img.height/2) })
        URL.revokeObjectURL(url)
      }
      img.src=url
    }
  }, [])

  // ── SVG click ──
  const handleSvgClick = useCallback((e) => {
    let target = e.target
    while (target&&target.tagName!=='svg') {
      const color = getElementColor(target)
      if (color) {
        if (eyedropperMode==='replace') { setReplacementColor(color); setEyedropperMode(null); setHint(`Picked ${color} as replacement`); return }
        if (eyedropperMode==='paint') { setPaintColor(color); setEyedropperMode(null); setHint(`Picked ${color} as paint color`); return }
        setSelectedColor(color); setHint(`Selected ${color} — pick a replacement below`); return
      }
      target = target.parentElement
    }
  }, [eyedropperMode])

  // ── Canvas click ──
  const handleCanvasClick = useCallback((e) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x=Math.round((e.clientX-rect.left)*canvas.width/rect.width)
    const y=Math.round((e.clientY-rect.top)*canvas.height/rect.height)
    const px = canvas.getContext('2d').getImageData(x,y,1,1).data
    if (px[3]<64) return
    const hex = rgbToHex(px[0],px[1],px[2])
    if (eyedropperMode==='replace') { setReplacementColor(hex); setEyedropperMode(null); setHint(`Picked ${hex} as replacement`); return }
    if (eyedropperMode==='paint') { setPaintColor(hex); setEyedropperMode(null); setHint(`Picked ${hex} as paint color`); return }
    if (showPixelEdit) setZoomCenter({ x, y })
    const closest = colors.find(c=>colorDistance(c,hex)<40)
    const pick = closest||hex
    if (!colors.includes(pick)) setColors(prev=>[pick,...prev])
    setSelectedColor(pick); setHint(`Picked ${pick} — choose replacement`)
  }, [colors, eyedropperMode, showPixelEdit])

  // ── Apply replacement ──
  const applyReplacement = useCallback(() => {
    if (!selectedColor) return
    if (fileType==='svg') {
      setPreviewSvg(replaceSVGColor(previewSvg,selectedColor,replacementColor))
      setColors(prev=>[...new Set(prev.map(c=>c===selectedColor?replacementColor:c))])
    } else {
      const canvas=canvasRef.current; if(!canvas) return
      replaceRasterColor(canvas,selectedColor,replacementColor,tolerance)
      setColors(prev=>[...new Set(prev.map(c=>c===selectedColor?replacementColor:c))])
      if(showPixelEdit) renderZoom()
    }
    setReplacements(prev=>[...prev,{from:selectedColor,to:replacementColor}])
    setHint(`✓ Replaced ${selectedColor} → ${replacementColor}`)
    setSelectedColor(null)
  }, [selectedColor,replacementColor,fileType,previewSvg,tolerance,showPixelEdit,renderZoom])

  // ── Background removal ──
  const handleRemoveBackground = useCallback(() => {
    if (fileType==='svg'&&previewSvg) {
      const cleaned = removeSVGBackground(previewSvg)
      setPreviewSvg(cleaned); setColors(extractSVGColors(cleaned))
      setReplacements(prev=>[...prev,{from:'background',to:'transparent'}])
      setHint('✓ Background removed')
    } else if (fileType==='raster') {
      const canvas=canvasRef.current; if(!canvas) return
      removeRasterBackground(canvas,bgTolerance)
      const imgData=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)
      setColors(sampleImageColors(imgData))
      setReplacements(prev=>[...prev,{from:'background',to:'transparent'}])
      setHint('✓ Background removed — download as PNG to keep transparency')
      if(showPixelEdit) renderZoom()
    }
    setSelectedColor(null)
  }, [fileType,previewSvg,bgTolerance,showPixelEdit,renderZoom])

  // ── Merge groups ──
  const handleMergeGroup = useCallback((group) => {
    const target=group[0], toMerge=group.slice(1)
    if (fileType==='svg') {
      let svg=previewSvg; toMerge.forEach(c=>{ svg=replaceSVGColor(svg,c,target) }); setPreviewSvg(svg)
    } else {
      const canvas=canvasRef.current; if(!canvas) return
      toMerge.forEach(c=>replaceRasterColor(canvas,c,target,15))
      if(showPixelEdit) renderZoom()
    }
    setColors(prev=>[...new Set(prev.map(c=>toMerge.includes(c)?target:c))])
    toMerge.forEach(c=>setReplacements(prev=>[...prev,{from:c,to:target}]))
    setHint(`✓ Merged ${group.length} similar colors into ${target}`)
  }, [fileType,previewSvg,showPixelEdit,renderZoom])

  const handleMergeAll = useCallback(() => {
    if (similarGroups.length===0) return
    let svg=previewSvg; const canvas=canvasRef.current
    const newColors=[...colors]; const newReps=[]
    for (const group of similarGroups) {
      const target=group[0], toMerge=group.slice(1)
      if (fileType==='svg') toMerge.forEach(c=>{ svg=replaceSVGColor(svg,c,target) })
      else if(canvas) toMerge.forEach(c=>replaceRasterColor(canvas,c,target,15))
      toMerge.forEach(c=>{ const i=newColors.indexOf(c); if(i!==-1) newColors.splice(i,1); newReps.push({from:c,to:target}) })
    }
    if(fileType==='svg') setPreviewSvg(svg)
    setColors([...new Set(newColors)]); setReplacements(prev=>[...prev,...newReps])
    setHint(`✓ Merged ${newReps.length} near-duplicate colors`)
    if(showPixelEdit && fileType==='raster') renderZoom()
  }, [similarGroups,fileType,previewSvg,colors,showPixelEdit,renderZoom])

  // ── Crisp lines ──
  const handleSharpen = useCallback(() => {
    const canvas = canvasRef.current; if(!canvas) return
    sharpenCanvas(canvas)
    if(showPixelEdit) renderZoom()
    setReplacements(prev=>[...prev,{from:'edges',to:'sharpened'}])
    setHint('✓ Edges sharpened')
  }, [showPixelEdit, renderZoom])

  const handleSnapAlpha = useCallback(() => {
    const canvas = canvasRef.current; if(!canvas) return
    snapAlphaCanvas(canvas, crispThreshold)
    if(showPixelEdit) renderZoom()
    setReplacements(prev=>[...prev,{from:'alpha',to:'snapped'}])
    setHint('✓ Semi-transparent pixels snapped crisp')
  }, [crispThreshold, showPixelEdit, renderZoom])

  // ── Reset / download ──
  const reset = useCallback(() => {
    if(fileType==='svg'&&svgContent) { setPreviewSvg(svgContent); setColors(extractSVGColors(svgContent)) }
    else {
      const orig=origCanvasRef.current, canvas=canvasRef.current
      if(!orig||!canvas) return
      canvas.getContext('2d').drawImage(orig,0,0)
      setColors(sampleImageColors(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height)))
      if(showPixelEdit) setTimeout(renderZoom,50)
    }
    setReplacements([]); setSelectedColor(null); setHint('Reset to original')
  }, [fileType,svgContent,showPixelEdit,renderZoom])

  const download = useCallback(() => {
    if(fileType==='svg'&&previewSvg) {
      const blob=new Blob([previewSvg],{type:'image/svg+xml'})
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a'); a.href=url; a.download=file?.name||'logo-edited.svg'; a.click()
      URL.revokeObjectURL(url)
    } else {
      canvasRef.current?.toBlob(blob=>{
        const url=URL.createObjectURL(blob)
        const a=document.createElement('a'); a.href=url
        a.download=(file?.name||'logo-edited').replace(/\.[^.]+$/,'')+'.png'; a.click()
        URL.revokeObjectURL(url)
      })
    }
  }, [fileType,previewSvg,file])

  const handleDrop = e => {
    e.preventDefault(); setIsDragging(false)
    const f=e.dataTransfer.files[0]; if(f) handleFile(f)
  }

  const cursorClass = eyedropperMode ? 'cursor-eyedropper' : ''

  // ── Landing page ──
  if (!file) return (
    <div className="app">
      <header className="header">
        <div className="logo-mark">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="8" fill="#4ade80"/>
            <path d="M7 14L14 7L21 14L14 21L7 14Z" fill="#0d0d0f"/>
            <circle cx="14" cy="14" r="3" fill="#4ade80"/>
          </svg>
          <span className="logo-name">LogoSwap</span>
        </div>
        <span className="tagline">Replace any color in your logo — instantly</span>
      </header>
      <main className="landing">
        <div className={`upload-zone ${isDragging?'dragging':''}`}
          onDragOver={e=>{e.preventDefault();setIsDragging(true)}} onDragLeave={()=>setIsDragging(false)}
          onDrop={handleDrop} onClick={()=>fileInputRef.current?.click()}>
          <div className="upload-icon-wrap">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="23" stroke="#2a2a35" strokeWidth="2"/>
              <path d="M24 32V16M16 24l8-8 8 8" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h2>Drop your logo here</h2>
          <p>Supports SVG, PNG, JPG, WebP</p>
          <div className="upload-btn">Choose file</div>
          <input ref={fileInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml"
            style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
        </div>
        <div className="features">
          <div className="feature"><span className="feature-icon">🎯</span><strong>Click to pick</strong><span>Click any color in your logo</span></div>
          <div className="feature"><span className="feature-icon">🎨</span><strong>Replace everywhere</strong><span>Swap across the entire logo at once</span></div>
          <div className="feature"><span className="feature-icon">🧹</span><strong>Clean up</strong><span>Remove backgrounds, crisp edges, merge colors</span></div>
          <div className="feature"><span className="feature-icon">🔍</span><strong>Pixel edit</strong><span>Zoom in and paint individual pixels</span></div>
        </div>
      </main>
    </div>
  )

  // ── Editor ──
  return (
    <div className="app">
      <header className="header">
        <div className="logo-mark">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="8" fill="#4ade80"/>
            <path d="M7 14L14 7L21 14L14 21L7 14Z" fill="#0d0d0f"/>
            <circle cx="14" cy="14" r="3" fill="#4ade80"/>
          </svg>
          <span className="logo-name">LogoSwap</span>
        </div>
        <div className="header-file">
          <span className="file-name">{file.name}</span>
          <button className="btn-ghost" onClick={()=>{setFile(null);setSvgContent(null);setPreviewSvg(null);setColors([]);setReplacements([]);setShowPixelEdit(false)}}>← New file</button>
        </div>
        {replacements.length>0 && <button className="btn-download" onClick={download}>↓ Download</button>}
      </header>

      {hint && <div className="hint-bar">{hint}</div>}
      {eyedropperMode && (
        <div className="eyedropper-bar">
          <span>👁 Eyedropper active — click anywhere on the logo to pick a color</span>
          <button onClick={()=>setEyedropperMode(null)}>Cancel</button>
        </div>
      )}

      <div className="editor">
        {/* Preview Panel */}
        <div className="preview-panel">
          <div className="preview-label">
            <span>PREVIEW</span>
            <span className="preview-hint">
              {eyedropperMode ? '👁 Click to pick color' : 'Click the logo to select a color'}
            </span>
          </div>
          <div className={`preview-area ${cursorClass}`}>
            {fileType==='svg'&&previewSvg ? (
              <div ref={svgContainerRef} className="svg-preview"
                dangerouslySetInnerHTML={{__html:previewSvg}} onClick={handleSvgClick}/>
            ) : (
              <canvas ref={canvasRef} className="canvas-preview" onClick={handleCanvasClick}/>
            )}
            <canvas ref={origCanvasRef} style={{display:'none'}}/>
          </div>
          <div className="preview-footer">
            <button className="btn-ghost" onClick={reset}>↺ Reset all</button>
            {replacements.length>0 && <span className="changes-badge">{replacements.length} change{replacements.length!==1?'s':''}</span>}
          </div>
        </div>

        {/* Controls Panel */}
        <div className="controls-panel">

          {/* ── 🧹 Clean Up ── */}
          <div className="section cleanup-section">
            <h3 className="section-title">🧹 Clean Up</h3>

            {/* Remove Background */}
            <div className="cleanup-card">
              <div className="cleanup-card-header">
                <span className="cleanup-card-title">Remove Background</span>
                <span className="cleanup-card-desc">Flood-fills transparency from edges</span>
              </div>
              {fileType==='raster' && (
                <div className="tolerance-wrap" style={{marginTop:10}}>
                  <div className="tolerance-header"><span>Edge tolerance</span><code>{bgTolerance}</code></div>
                  <input type="range" min="5" max="100" value={bgTolerance}
                    onChange={e=>setBgTolerance(Number(e.target.value))} className="slider"/>
                  <div className="tolerance-labels"><span>Tight</span><span>Loose</span></div>
                </div>
              )}
              <button className="btn-cleanup" onClick={handleRemoveBackground}>Remove Background</button>
            </div>

            {/* Crisp Lines — raster only */}
            {fileType==='raster' && (
              <div className="cleanup-card">
                <div className="cleanup-card-header">
                  <span className="cleanup-card-title">Crisp Lines</span>
                  <span className="cleanup-card-desc">Sharpen edges and snap semi-transparent pixels</span>
                </div>
                <div className="crisp-buttons">
                  <button className="btn-cleanup-half" onClick={handleSharpen}>Sharpen Edges</button>
                  <button className="btn-cleanup-half" onClick={handleSnapAlpha}>Snap Alpha</button>
                </div>
                <div className="tolerance-wrap" style={{marginTop:8}}>
                  <div className="tolerance-header"><span>Snap threshold</span><code>{crispThreshold}</code></div>
                  <input type="range" min="1" max="254" value={crispThreshold}
                    onChange={e=>setCrispThreshold(Number(e.target.value))} className="slider"/>
                  <div className="tolerance-labels"><span>More transparent</span><span>More opaque</span></div>
                </div>
              </div>
            )}

            {/* Merge Similar Colors */}
            <div className="cleanup-card">
              <div className="cleanup-card-header">
                <span className="cleanup-card-title">Merge Similar Colors</span>
                <span className="cleanup-card-desc">
                  {similarGroups.length>0
                    ? `${similarGroups.length} group${similarGroups.length!==1?'s':''} of near-duplicates found`
                    : 'No near-duplicate colors detected'}
                </span>
              </div>
              <div className="tolerance-wrap" style={{marginTop:10}}>
                <div className="tolerance-header"><span>Similarity threshold</span><code>{mergeTolerance}</code></div>
                <input type="range" min="5" max="60" value={mergeTolerance}
                  onChange={e=>setMergeTolerance(Number(e.target.value))} className="slider"/>
                <div className="tolerance-labels"><span>Strict</span><span>Loose</span></div>
              </div>
              {similarGroups.length>0 && (
                <div className="merge-groups">
                  {similarGroups.map((group,i)=>(
                    <div key={i} className="merge-group-row">
                      <div className="merge-swatches">
                        {group.map(c=><div key={c} className="merge-swatch" style={{background:c}} title={c}/>)}
                        <span className="merge-arrow">→</span>
                        <div className="merge-swatch" style={{background:group[0],border:'2px solid var(--accent)'}} title={group[0]}/>
                      </div>
                      <button className="btn-merge-single" onClick={()=>handleMergeGroup(group)}>Merge</button>
                    </div>
                  ))}
                  <button className="btn-cleanup" onClick={handleMergeAll} style={{marginTop:8}}>
                    Merge All ({similarGroups.reduce((n,g)=>n+g.length-1,0)} colors)
                  </button>
                </div>
              )}
              {similarGroups.length===0&&colors.length>0 && (
                <p className="empty-state" style={{marginTop:8}}>All colors are distinct — try raising the threshold</p>
              )}
            </div>
          </div>

          {/* ── 🔍 Pixel Edit (raster only) ── */}
          {fileType==='raster' && (
            <div className="section">
              <div className="section-header">
                <h3 className="section-title">🔍 Pixel Edit</h3>
                <button className="btn-toggle" onClick={()=>{
                  const next = !showPixelEdit
                  setShowPixelEdit(next)
                  if (next) {
                    const canvas = canvasRef.current
                    if (canvas && canvas.width > 0) {
                      setZoomCenter({ x: Math.floor(canvas.width/2), y: Math.floor(canvas.height/2) })
                      setTimeout(renderZoom, 50)
                    }
                  }
                }}>{showPixelEdit ? 'Hide' : 'Show'}</button>
              </div>

              {showPixelEdit && (
                <>
                  {/* Paint color + eyedropper */}
                  <div className="paint-row">
                    <span className="col-label">PAINT COLOR</span>
                    <div className="paint-color-wrap">
                      <div className="color-picker-wrap" style={{width:36,height:36,borderRadius:8}}>
                        <input type="color" value={paintColor}
                          onChange={e=>setPaintColor(e.target.value)} className="color-picker"/>
                      </div>
                      <code className="color-code">{paintColor}</code>
                    </div>
                    <button
                      className={`btn-eyedropper ${eyedropperMode==='paint'?'active':''}`}
                      onClick={()=>setEyedropperMode(eyedropperMode==='paint'?null:'paint')}
                      title="Pick paint color from image">
                      <EyedropperIcon/>
                    </button>
                  </div>

                  {/* Zoom level */}
                  <div className="zoom-levels">
                    <span className="col-label">ZOOM</span>
                    {[4,8,16,32].map(z => (
                      <button key={z}
                        className={`btn-zoom-level ${zoomLevel===z?'active':''}`}
                        onClick={()=>{ setZoomLevel(z); setTimeout(renderZoom,10) }}>
                        {z}×
                      </button>
                    ))}
                  </div>

                  {/* Zoom canvas */}
                  <div className="zoom-canvas-wrap">
                    <canvas
                      ref={zoomCanvasRef}
                      width={240} height={240}
                      className="zoom-canvas"
                      onMouseDown={e=>{ isPaintingRef.current=true; paintPixel(e) }}
                      onMouseMove={e=>{ if(isPaintingRef.current) paintPixel(e) }}
                      onMouseUp={()=>{ isPaintingRef.current=false }}
                      onMouseLeave={()=>{ isPaintingRef.current=false }}
                    />
                    <p className="zoom-hint">Click main image to reposition · Click/drag here to paint</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Color palette ── */}
          <div className="section">
            <div className="section-header">
              <h3 className="section-title">Colors in logo</h3>
              <span className="section-sub">Click to select</span>
            </div>
            <div className="color-grid">
              {colors.map(color=>(
                <ColorSwatch key={color} color={color} selected={selectedColor===color}
                  onClick={()=>setSelectedColor(selectedColor===color?null:color)}/>
              ))}
            </div>
            {colors.length===0 && <p className="empty-state">No colors detected yet</p>}
          </div>

          {/* ── Replace controls ── */}
          <div className={`replace-section ${selectedColor?'active':''}`}>
            {!selectedColor ? (
              <div className="replace-placeholder">
                <span>👆</span>
                <p>Select a color above or click directly on your logo</p>
              </div>
            ) : (
              <>
                <h3 className="section-title">Replace color</h3>
                <div className="replace-row">
                  <div className="color-col">
                    <span className="col-label">FROM</span>
                    <div className="color-box" style={{background:selectedColor}}/>
                    <code className="color-code">{selectedColor}</code>
                  </div>
                  <div className="replace-arrow">→</div>
                  <div className="color-col">
                    <span className="col-label">TO</span>
                    <div className="color-picker-row">
                      <div className="color-picker-wrap">
                        <input type="color" value={replacementColor}
                          onChange={e=>setReplacementColor(e.target.value)} className="color-picker"/>
                      </div>
                      <button
                        className={`btn-eyedropper ${eyedropperMode==='replace'?'active':''}`}
                        onClick={()=>setEyedropperMode(eyedropperMode==='replace'?null:'replace')}
                        title="Pick replacement color from image">
                        <EyedropperIcon/>
                      </button>
                    </div>
                    <code className="color-code">{replacementColor}</code>
                  </div>
                </div>
                {fileType==='raster' && (
                  <div className="tolerance-wrap">
                    <div className="tolerance-header"><span>Tolerance</span><code>{tolerance}</code></div>
                    <input type="range" min="0" max="120" value={tolerance}
                      onChange={e=>setTolerance(Number(e.target.value))} className="slider"/>
                    <div className="tolerance-labels"><span>Exact</span><span>Broad</span></div>
                  </div>
                )}
                <button className="btn-apply" onClick={applyReplacement}>Apply Replacement</button>
                <button className="btn-cancel" onClick={()=>setSelectedColor(null)}>Cancel</button>
              </>
            )}
          </div>

          {/* ── History ── */}
          {replacements.length>0 && (
            <div className="section">
              <h3 className="section-title">Changes</h3>
              <div className="changes-list">
                {[...replacements].reverse().map((r,i)=>(
                  <div key={i} className="change-row">
                    {r.from==='background' ? (
                      <><div className="change-swatch checker"/><span className="change-arr">→</span>
                      <div className="change-swatch transparent-swatch"/><code className="change-code">Background removed</code></>
                    ) : r.from==='edges' || r.from==='alpha' ? (
                      <><span style={{fontSize:14}}>✨</span><code className="change-code">{r.to==='sharpened'?'Edges sharpened':'Alpha snapped crisp'}</code></>
                    ) : (
                      <><div className="change-swatch" style={{background:r.from}}/><span className="change-arr">→</span>
                      <div className="change-swatch" style={{background:r.to}}/><code className="change-code">{r.from} → {r.to}</code></>
                    )}
                  </div>
                ))}
              </div>
              <button className="btn-download-full" onClick={download}>↓ Download edited logo</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
