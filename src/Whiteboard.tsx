import React, { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { Upload, PenTool, Eraser, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { getSocket } from './api'

// We use unpkg for the worker to avoid copying it to public/ manually
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export function InteractiveWhiteboard({ courseId, isTutor }: { courseId: string; isTutor: boolean }) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [color, setColor] = useState('#000000')
  const [isEraser, setIsEraser] = useState(false)
  
  const bgCanvasRef = useRef<HTMLCanvasElement>(null)
  const drawCanvasRef = useRef<HTMLCanvasElement>(null)
  
  const isDrawing = useRef(false)
  const lastPos = useRef<{x: number, y: number} | null>(null)

  // Listen for socket events
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
    })
    
    socket.on('wb-page', (num: number) => {
      setPageNum(num)
    })
    
    return () => {
      socket.off('wb-draw')
      socket.off('wb-clear')
      socket.off('wb-page')
    }
  }, [])

  // Render PDF page
  useEffect(() => {
    if (!pdf) return
    let renderTask: any = null
    const renderPage = async () => {
      try {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        
        const bgCanvas = bgCanvasRef.current
        const drawCanvas = drawCanvasRef.current
        if (!bgCanvas || !drawCanvas) return
        
        bgCanvas.width = viewport.width
        bgCanvas.height = viewport.height
        drawCanvas.width = viewport.width
        drawCanvas.height = viewport.height
        
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fileUrl = URL.createObjectURL(file)
    const loadedPdf = await pdfjsLib.getDocument(fileUrl).promise
    setPdf(loadedPdf)
    setPageNum(1)
    getSocket().emit('wb-page', courseId, 1)
    clearBoard()
  }

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
      getSocket().emit('wb-clear', courseId)
    }
  }

  // Drawing Handlers
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

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    isDrawing.current = true
    lastPos.current = getMousePos(e)
  }

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || !lastPos.current) return
    
    const currPos = getMousePos(e)
    const ctx = drawCanvasRef.current?.getContext('2d')
    if (!ctx) return
    
    // Local draw
    ctx.strokeStyle = color
    ctx.lineWidth = isEraser ? 20 : 3
    ctx.lineCap = 'round'
    if (isEraser) ctx.globalCompositeOperation = 'destination-out'
    else ctx.globalCompositeOperation = 'source-over'
    
    ctx.beginPath()
    ctx.moveTo(lastPos.current.x, lastPos.current.y)
    ctx.lineTo(currPos.x, currPos.y)
    ctx.stroke()
    
    // Emit
    getSocket().emit('wb-draw', courseId, {
      x0: lastPos.current.x, y0: lastPos.current.y,
      x1: currPos.x, y1: currPos.y,
      color, isEraser
    })
    
    lastPos.current = currPos
  }

  const endDraw = () => {
    isDrawing.current = false
    lastPos.current = null
  }

  return (
    <div className="flex flex-col h-full w-full rounded-2xl overflow-hidden" style={{ background: 'var(--bg)', border: '2px solid var(--card-line)' }}>
      <div className="flex items-center gap-4 p-3 border-b" style={{ borderColor: 'var(--card-line)', background: 'var(--bg-soft)' }}>
        <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setIsEraser(false) }} className="w-8 h-8 cursor-pointer rounded" />
        
        <button onClick={() => setIsEraser(false)} className={`p-2 rounded-xl transition ${!isEraser ? 'bg-[var(--honey)]' : 'hover:bg-white/50'}`}>
          <PenTool size={20} />
        </button>
        <button onClick={() => setIsEraser(true)} className={`p-2 rounded-xl transition ${isEraser ? 'bg-[var(--honey)]' : 'hover:bg-white/50'}`}>
          <Eraser size={20} />
        </button>
        <button onClick={clearBoard} className="p-2 rounded-xl hover:bg-white/50 text-red-500">
          <Trash2 size={20} />
        </button>

        <div className="flex-1" />

        {isTutor && (
          <div className="flex items-center gap-2">
            <button onClick={() => changePage(-1)} className="p-2 rounded-xl hover:bg-white/50"><ChevronLeft size={20} /></button>
            <span className="font-bold text-sm">{pageNum} / {pdf ? pdf.numPages : 1}</span>
            <button onClick={() => changePage(1)} className="p-2 rounded-xl hover:bg-white/50"><ChevronRight size={20} /></button>
            <div className="w-px h-6 bg-black/10 mx-2" />
            <label className="flex items-center gap-2 px-3 py-1.5 rounded-xl cursor-pointer font-bold text-sm" style={{ background: 'var(--honey)' }}>
              <Upload size={16} /> Upload PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        )}
      </div>

      <div className="flex-1 relative overflow-auto bg-gray-100 flex items-center justify-center p-4">
        <div className="relative shadow-lg" style={{ minWidth: 800, minHeight: 600 }}>
          <canvas ref={bgCanvasRef} className="absolute inset-0 bg-white" />
          <canvas 
            ref={drawCanvasRef} 
            className="absolute inset-0 z-10 cursor-crosshair touch-none"
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
        </div>
      </div>
    </div>
  )
}
