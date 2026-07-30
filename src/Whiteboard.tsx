import React, { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Upload, PenTool, Eraser, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { getSocket, api } from './api'
import { Type } from 'lucide-react'

// We use unpkg for the worker to avoid copying it to public/ manually
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export function InteractiveWhiteboard({ courseId }: { courseId: string }) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [color, setColor] = useState('#000000')
  const [tool, setTool] = useState<'pen' | 'eraser' | 'type'>('pen')
  const [resources, setResources] = useState<any[]>([])
  const currentPdfUrl = useRef<string | null>(null)
  
  const wrapperRef = useRef<HTMLDivElement>(null)
  const isSyncingScroll = useRef(false)
  
  // Text Tool State
  const [activeText, setActiveText] = useState<{ x: number; y: number; text: string } | null>(null)
  const [texts, setTexts] = useState<Record<string, { x: number; y: number; text: string; color: string; typing: boolean }>>({})
  const activeTextRef = useRef<HTMLInputElement>(null)
  
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  
  const isDrawing = useRef(false)
  const lastPos = useRef<{x: number, y: number} | null>(null)

  useEffect(() => {
    const socket = getSocket()
    
    socket.on('wb-draw', (data: any) => {
      const ctx = drawCanvasRef.current?.getContext('2d')
      if (!ctx) return
      ctx.strokeStyle = data.color
      ctx.lineWidth = data.isEraser ? 20 : 3
      ctx.lineCap = 'round'
      if (data.isEraser) ctx.globalCompositeOperation = 'destination-out'
      else ctx.globalCompositeOperation = 'source-over'
      
      ctx.beginPath()
      ctx.moveTo(data.x0, data.y0)
      ctx.lineTo(data.x1, data.y1)
      ctx.stroke()
    })
    
    socket.on('wb-clear', () => {
      const ctx = drawCanvasRef.current?.getContext('2d')
      if (ctx && drawCanvasRef.current) {
        ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
      }
      setTexts({})
    })
    
    socket.on('wb-page', (num: number) => {
      setPageNum(num)
      setTexts({})
      const ctx = drawCanvasRef.current?.getContext('2d')
      if (ctx && drawCanvasRef.current) {
        ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
      }
    })
    
    socket.on('wb-type-live', (data: { id: string, x: number, y: number, text: string, color: string }) => {
      setTexts(prev => ({ ...prev, [data.id]: { ...data, typing: true } }))
    })
    
    socket.on('wb-type-end', (id: string) => {
      setTexts(prev => {
        const next = { ...prev }
        if (next[id]) next[id].typing = false
        return next
      })
    })

    socket.on('wb-request-state', (requesterId: string) => {
      // If we are currently active, send our board state to the new user.
      const canvas = drawCanvasRef.current
      if (canvas) {
        socket.emit('wb-sync-state', requesterId, {
          pageNum,
          drawDataUrl: canvas.toDataURL(),
          texts,
          pdfUrl: currentPdfUrl.current
        })
      }
    })

    socket.on('wb-sync-state', (state: any) => {
      if (state.pageNum) setPageNum(state.pageNum)
      if (state.texts) setTexts(state.texts)
      if (state.pdfUrl) {
        loadPdfFromUrl(state.pdfUrl)
      }
      if (state.drawDataUrl) {
        const img = new Image()
        img.onload = () => {
          const ctx = drawCanvasRef.current?.getContext('2d')
          if (ctx) ctx.drawImage(img, 0, 0)
        }
        img.src = state.drawDataUrl
      }
    })

    socket.on('wb-set-pdf', (url: string) => {
      loadPdfFromUrl(url)
    })
    
    socket.on('wb-scroll', (data: { scrollTop: number, scrollLeft: number }) => {
      if (wrapperRef.current) {
        isSyncingScroll.current = true
        wrapperRef.current.scrollTop = data.scrollTop
        wrapperRef.current.scrollLeft = data.scrollLeft
        setTimeout(() => isSyncingScroll.current = false, 100)
      }
    })
    
    // When mounting, ask someone for the current board state
    socket.emit('wb-request-state-broadcast', courseId)

    return () => {
      socket.off('wb-draw')
      socket.off('wb-clear')
      socket.off('wb-page')
      socket.off('wb-type-live')
      socket.off('wb-type-end')
      socket.off('wb-request-state')
      socket.off('wb-sync-state')
      socket.off('wb-set-pdf')
      socket.off('wb-scroll')
    }
  }, [courseId, pageNum, texts])

  useEffect(() => {
    api.resources.list(courseId).then(setResources).catch(console.error)
  }, [courseId])

  const loadPdfFromUrl = async (url: string) => {
    currentPdfUrl.current = url
    try {
      // Make sure the URL has the correct domain if it's relative
      const loadedPdf = await pdfjsLib.getDocument(url).promise
      setPdf(loadedPdf)
      setPageNum(1)
      clearBoard()
    } catch (e) {
      console.error("Failed to load PDF", e)
    }
  }

  useEffect(() => {
    if (!pdf) return
    let renderTask: any = null
    const renderPage = async () => {
      try {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        
        const bgCanvas = bgCanvasRef.current
        const drawCanvas = drawCanvasRef.current
        if (!bgCanvas || !drawCanvas || !containerRef.current) return
        
        bgCanvas.width = viewport.width
        bgCanvas.height = viewport.height
        drawCanvas.width = viewport.width
        drawCanvas.height = viewport.height
        containerRef.current.style.width = `${viewport.width}px`
        containerRef.current.style.height = `${viewport.height}px`
        
        const ctx = bgCanvas.getContext('2d')
        if (ctx) {
          renderTask = page.render({ canvasContext: ctx, viewport })
          await renderTask.promise
        }
      } catch (err) {
        if ((err as any).name !== 'RenderingCancelledException') {
          console.error("PDF Render Error", err)
        }
      }
    }
    renderPage()
    
    return () => {
      if (renderTask) renderTask.cancel()
    }
  }, [pdf, pageNum])

  const changePage = (offset: number) => {
    if (!pdf) return
    const newPage = pageNum + offset
    if (newPage >= 1 && newPage <= pdf.numPages) {
      setPageNum(newPage)
      getSocket().emit('wb-page', courseId, newPage)
      clearBoard()
    }
  }

  const clearBoard = () => {
    const ctx = drawCanvasRef.current?.getContext('2d')
    if (ctx && drawCanvasRef.current) {
      ctx.clearRect(0, 0, drawCanvasRef.current.width, drawCanvasRef.current.height)
      setTexts({})
      getSocket().emit('wb-clear', courseId)
    }
  }

  const getMousePos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    let clientX, clientY
    if ('touches' in e) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = (e as React.MouseEvent).clientX
      clientY = (e as React.MouseEvent).clientY
    }
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    }
  }

  const handleCanvasPointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'type') {
      const pos = getMousePos(e)
      setActiveText({ x: pos.x, y: pos.y, text: '' })
      setTimeout(() => activeTextRef.current?.focus(), 50)
      return
    }
    isDrawing.current = true
    lastPos.current = getMousePos(e)
  }

  const handleCanvasPointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !lastPos.current || tool === 'type') return
    
    const currPos = getMousePos(e)
    const ctx = drawCanvasRef.current?.getContext('2d')
    if (!ctx) return
    
    const isEraser = tool === 'eraser'
    ctx.strokeStyle = color
    ctx.lineWidth = isEraser ? 20 : 3
    ctx.lineCap = 'round'
    if (isEraser) ctx.globalCompositeOperation = 'destination-out'
    else ctx.globalCompositeOperation = 'source-over'
    
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(currPos.x, currPos.y)
    ctx.stroke()
    
    getSocket().emit('wb-draw', courseId, {
      x0: lastPos.current.x, y0: lastPos.current.y,
      x1: currPos.x, y1: currPos.y,
      color, isEraser
    })
    
    lastPos.current = currPos
  }

  const handleCanvasPointerUp = () => {
    isDrawing.current = false
    lastPos.current = null
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!activeText) return
    const text = e.target.value
    setActiveText({ ...activeText, text })
    getSocket().emit('wb-type-live', courseId, { id: getSocket().id, x: activeText.x, y: activeText.y, text, color })
  }

  const commitText = () => {
    if (activeText && activeText.text.trim()) {
      setTexts(prev => ({ ...prev, [getSocket().id!]: { x: activeText.x, y: activeText.y, text: activeText.text, color, typing: false } }))
      getSocket().emit('wb-type-end', courseId, getSocket().id)
    }
    setActiveText(null)
  }

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg)]">
      <div className="flex items-center gap-4 p-3 border-b border-[var(--card-line)] bg-[var(--bg-soft)]">
        <input type="color" value={color} onChange={(e) => { setColor(e.target.value); if(tool === 'eraser') setTool('pen') }} className="w-8 h-8 cursor-pointer rounded" />
        
        <button onClick={() => setTool('pen')} className={`p-2 rounded-xl transition ${tool === 'pen' ? 'bg-[var(--honey)]' : 'hover:bg-white/50'}`} title="Pen">
          <PenTool size={20} />
        </button>
        <button onClick={() => setTool('type')} className={`p-2 rounded-xl transition ${tool === 'type' ? 'bg-[var(--honey)]' : 'hover:bg-white/50'}`} title="Text">
          <Type size={20} />
        </button>
        <button onClick={() => setTool('eraser')} className={`p-2 rounded-xl transition ${tool === 'eraser' ? 'bg-[var(--honey)]' : 'hover:bg-white/50'}`} title="Eraser">
          <Eraser size={20} />
        </button>
        <button onClick={clearBoard} className="p-2 rounded-xl hover:bg-white/50 text-red-500" title="Clear All">
          <Trash2 size={20} />
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          <button onClick={() => changePage(-1)} className="p-2 rounded-xl hover:bg-white/50"><ChevronLeft size={20} /></button>
          <span className="font-bold text-sm bg-white/50 px-3 py-1 rounded-lg border border-[var(--card-line)]">{pageNum} / {pdf ? pdf.numPages : 1}</span>
          <button onClick={() => changePage(1)} className="p-2 rounded-xl hover:bg-white/50"><ChevronRight size={20} /></button>
          <div className="w-px h-6 bg-[var(--card-line)] mx-2" />
          
          <select 
            className="px-3 py-2 rounded-xl font-bold text-sm outline-none border-2 border-[var(--card-line)] bg-white cursor-pointer"
            onChange={(e) => {
              if (e.target.value) {
                const url = e.target.value
                loadPdfFromUrl(url)
                getSocket().emit('wb-set-pdf', courseId, url)
                e.target.value = ''
              }
            }}
          >
            <option value="">📂 Open from Resources</option>
            {resources.filter(r => r.file_url && r.file_url.toLowerCase().endsWith('.pdf')).map(r => (
              <option key={r.id} value={r.file_url}>{r.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div 
        ref={wrapperRef}
        className="flex-1 relative overflow-auto bg-gray-100 flex items-center justify-center p-4"
        onScroll={(e) => {
          if (isSyncingScroll.current) return
          const target = e.target as HTMLDivElement
          getSocket().emit('wb-scroll', courseId, { scrollTop: target.scrollTop, scrollLeft: target.scrollLeft })
        }}
      >
        <div ref={containerRef} className="relative shadow-2xl bg-white" style={{ minWidth: 800, minHeight: 600 }}>
          <canvas ref={bgCanvasRef} className="absolute inset-0 bg-white" />
          <canvas 
            ref={drawCanvasRef} 
            className={`absolute inset-0 z-10 touch-none ${tool === 'type' ? 'cursor-text' : 'cursor-crosshair'}`}
            onMouseDown={handleCanvasPointerDown}
            onMouseMove={handleCanvasPointerMove}
            onMouseUp={handleCanvasPointerUp}
            onMouseLeave={handleCanvasPointerUp}
            onTouchStart={handleCanvasPointerDown}
            onTouchMove={handleCanvasPointerMove}
            onTouchEnd={handleCanvasPointerUp}
          />
          
          {/* Render Committed Texts (Live & Finished) */}
          {Object.entries(texts).map(([id, t]) => (
            <div key={id} className={`absolute z-20 font-sans text-xl font-medium px-1 pointer-events-none ${t.typing ? 'border-b-2 border-blue-500 animate-pulse' : ''}`} style={{ left: t.x, top: t.y - 14, color: t.color, whiteSpace: 'pre' }}>
              {t.text}
            </div>
          ))}
          
          {/* Render Active Text Input (Self) */}
          {activeText && (
            <input
              ref={activeTextRef}
              value={activeText.text}
              onChange={handleTextChange}
              onBlur={commitText}
              onKeyDown={(e) => e.key === 'Enter' && commitText()}
              className="absolute z-30 bg-transparent outline-none border-b-2 border-blue-500 font-sans text-xl font-medium px-1"
              style={{ left: activeText.x, top: activeText.y - 14, color: color, minWidth: '100px' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
