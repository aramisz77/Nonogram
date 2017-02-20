import Nonogram from './Nonogram'
import $ from './colors'

interface SolverLineOfHints extends LineOfHints {
  possibleBlanks?: number[][]
}

interface Scanner {
  disabled: boolean
  direction: Direction
  i: number
  line: Status[]
  hints: SolverLineOfHints
  error: boolean
}

const sum = (array: number[]) => array.reduce((a, b) => a + b, 0)

const cellValueMap = new Map<Status, Status>()
cellValueMap.set(Status.TEMP_FILLED, Status.FILLED)
cellValueMap.set(Status.TEMP_EMPTY, Status.EMPTY)
cellValueMap.set(Status.INCONSTANT, Status.UNSET)

export default class Solver extends Nonogram {
  demoMode: boolean
  delay: number
  handleSuccess: (time: number) => void
  handleError: (e: Error) => void
  isBusy: boolean
  scanner: Scanner
  hints: {
    row: SolverLineOfHints[]
    column: SolverLineOfHints[]
  }
  startTime: number

  constructor(
    row: number[][],
    column: number[][],
    canvas: string | HTMLCanvasElement,
    {
      theme = {},
      demoMode = true,
      delay = 50,
      onSuccess = () => { },
      onError = () => { },
    }: {
      theme?: Partial<Theme>
      demoMode?: boolean
      delay?: number
      onSuccess?: (time?: number) => void
      onError?: (e?: Error) => void
    } = {},
  ) {
    super()
    this.theme.filledColor = $.green
    this.theme.correctColor = $.green
    this.theme.wrongColor = $.yellow
    Object.assign(this.theme, theme)

    this.demoMode = demoMode
    this.delay = delay
    this.handleSuccess = onSuccess
    this.handleError = onError

    this.hints = {
      row: row.slice(),
      column: column.slice(),
    }
    this.removeNonPositiveHints()
    this.m = this.hints.row.length
    this.n = this.hints.column.length
    this.grid = new Array(this.m)
    for (let i = 0; i < this.m; i += 1) {
      this.grid[i] = new Array(this.n).fill(Status.UNSET)
    }
    this.hints.row.forEach((r) => {
      r.isCorrect = false
      r.unchanged = false
    })
    this.hints.column.forEach((c) => {
      c.isCorrect = false
      c.unchanged = false
    })

    this.scan = this.scan.bind(this)
    this.scanner = {
      disabled: true,
      direction: 'row',
      i: 0,
      line: [],
      hints: [],
      error: false,
    }

    this.initCanvas(canvas)
    this.print()
  }

  initListeners() {
    this.listeners = [
      ['click', this.click.bind(this)],
    ]
  }
  click(e: MouseEvent) {
    if (this.isBusy) return

    const rect = this.canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const d = rect.width * 2 / 3 / (this.n + 1)
    const location = this.getLocation(x, y)
    if (location === 'grid') {
      if (this.scanner && this.scanner.error) return

      const i = Math.floor(y / d - 0.5)
      const j = Math.floor(x / d - 0.5)
      if (this.grid[i][j] === Status.UNSET) {
        this.grid[i][j] = Status.FILLED
        this.hints.row[i].unchanged = false
        this.hints.column[j].unchanged = false
        this.solve()
      }
    } else if (location === 'controller') {
      this.refresh()
    }
  }
  refresh() {
    if (this.isBusy) return

    this.grid = new Array(this.m)
    for (let i = 0; i < this.m; i += 1) {
      this.grid[i] = new Array(this.n)
    }
    this.hints.row.forEach((r) => {
      r.isCorrect = false
      r.unchanged = false
      delete r.possibleBlanks
    })
    this.hints.column.forEach((c) => {
      c.isCorrect = false
      c.unchanged = false
      delete c.possibleBlanks
    })
    this.scanner.disabled = true

    this.solve()
  }
  solve() {
    if (this.isBusy) return

    this.isBusy = true
    this.startTime = Date.now()
    this.scan()
  }
  scan() {
    if (this.canvas.nonogram !== this) return

    this.updateScanner()
    if (this.scanner.disabled) return

    if (this.demoMode) {
      this.print()
    }
    this.scanner.error = true
    this.solveSingleLine()
    if (this.scanner.error) {
      this.isBusy = false
      this.print()
      this.handleError(new Error(`Bad hints at ${this.scanner.direction} ${this.scanner.i + 1}`))
      return
    }
    if (this.demoMode) {
      setTimeout(this.scan, this.delay)
    } else {
      this.scan()
    }
  }
  updateScanner() {
    let line
    do {
      if (this.scanner.disabled) {
        this.scanner = {
          disabled: false,
          direction: 'row',
          i: 0,
          line: [],
          hints: [],
          error: false,
        }
      } else {
        this.scanner.error = false
        this.scanner.i += 1
        if (this.hints[this.scanner.direction][this.scanner.i] === undefined) {
          this.scanner.direction = (this.scanner.direction === 'row') ? 'column' : 'row'
          this.scanner.i = 0
        }
      }
      line = this.hints[this.scanner.direction][this.scanner.i]

      if (this.hints.row.every(row => !!row.unchanged) &&
        this.hints.column.every(col => !!col.unchanged)) {
        this.scanner.disabled = true
        this.isBusy = false
        this.print()
        this.handleSuccess(Date.now() - this.startTime)
        return
      }
    }
    while (line.isCorrect || line.unchanged)
  }
  solveSingleLine() {
    this.scanner = <Scanner>this.scanner
    const { direction, i } = this.scanner
    this.scanner.hints = this.hints[direction][i]
    this.scanner.hints.unchanged = true

    this.scanner.line = this.getSingleLine(direction, i)
    const finished = this.scanner.line.every(cell => cell !== Status.UNSET)
    if (!finished) {
      if (this.scanner.hints.possibleBlanks === undefined) {
        this.scanner.hints.possibleBlanks = []
        this.findAllSituations(this.scanner.line.length - sum(this.scanner.hints) + 1)
      }
      this.mergeSituation()
      this.setBackToGrid()
    }
    if (this.isLineCorrect(direction, i)) {
      this.hints[direction][i].isCorrect = true
      if (finished) {
        this.scanner.error = false
      }
    }
  }
  findAllSituations(max: number, array: number[] = [], index = 0) {
    if (index === this.scanner.hints.length) {
      const blanks = array.slice(0, this.scanner.hints.length)
      blanks[0] -= 1
      if (this.scanner.hints.possibleBlanks) {
        this.scanner.hints.possibleBlanks.push(blanks)
      }
    }

    for (let i = 1; i <= max; i += 1) {
      array[index] = i
      this.findAllSituations(max - array[index], array, index + 1)
    }
  }
  mergeSituation() {
    const possibleBlanks = this.scanner.hints.possibleBlanks || []
    possibleBlanks.forEach((blanks, p) => {
      const line: Status[] = []
      for (let i = 0; i < this.scanner.hints.length; i += 1) {
        line.push(...new Array(blanks[i]).fill(Status.TEMP_EMPTY))
        line.push(...new Array(this.scanner.hints[i]).fill(Status.TEMP_FILLED))
      }
      line.push(...new Array(this.scanner.line.length - line.length).fill(Status.TEMP_EMPTY))

      const improper = line.some((cell, i) =>
        (cell === Status.TEMP_EMPTY && this.scanner.line[i] === Status.FILLED) ||
        (cell === Status.TEMP_FILLED && this.scanner.line[i] === Status.EMPTY)
      )
      if (improper) {
        delete possibleBlanks[p]
        return
      }

      this.scanner.error = false
      line.forEach((cell, i) => {
        if (cell === Status.TEMP_FILLED) {
          if (this.scanner.line[i] === Status.TEMP_EMPTY) {
            this.scanner.line[i] = Status.INCONSTANT
          } else if (this.scanner.line[i] === Status.UNSET) {
            this.scanner.line[i] = Status.TEMP_FILLED
          }
        } else if (cell === Status.TEMP_EMPTY) {
          if (this.scanner.line[i] === Status.TEMP_FILLED) {
            this.scanner.line[i] = Status.INCONSTANT
          } else if (this.scanner.line[i] === Status.UNSET) {
            this.scanner.line[i] = Status.TEMP_EMPTY
          }
        }
      })
    })
    this.scanner.hints.possibleBlanks = possibleBlanks.filter(e => e !== null)
  }
  setBackToGrid() {
    const { direction, i } = this.scanner
    if (direction === 'row') {
      this.scanner.line.forEach((cell, j) => {
        if (cellValueMap.has(cell)) {
          if (this.grid[i][j] !== cellValueMap.get(cell)) {
            this.grid[i][j] = <number>cellValueMap.get(cell)
            this.hints.column[j].unchanged = false
          }
        }
      })
    } else if (direction === 'column') {
      this.scanner.line.forEach((cell, j) => {
        if (cellValueMap.has(cell)) {
          if (this.grid[j][i] !== cellValueMap.get(cell)) {
            this.grid[j][i] = <number>cellValueMap.get(cell)
            this.hints.row[j].unchanged = false
          }
        }
      })
    }
  }

  print() {
    this.printGrid()
    this.printHints()
    this.printController()
    this.printScanner()
  }
  printController() {
    const { ctx } = this
    const { width: w, height: h } = this.canvas
    const controllerSize = Math.min(w, h) / 4
    const filledColor = this.theme.filledColor

    function getCycle() {
      const cycle = document.createElement('canvas')
      const borderWidth = controllerSize / 10
      cycle.width = controllerSize
      cycle.height = controllerSize

      const c = cycle.getContext('2d') || new CanvasRenderingContext2D()
      c.translate(controllerSize / 2, controllerSize / 2)
      c.rotate(Math.PI)
      c.arc(0, 0, controllerSize / 2 - borderWidth / 2, Math.PI / 2, Math.PI / 3.9)
      c.lineWidth = borderWidth
      c.strokeStyle = filledColor
      c.stroke()
      c.beginPath()
      c.moveTo((controllerSize / 2 + borderWidth) * Math.SQRT1_2,
        (controllerSize / 2 + borderWidth) * Math.SQRT1_2)
      c.lineTo((controllerSize / 2 - borderWidth * 2) * Math.SQRT1_2,
        (controllerSize / 2 - borderWidth * 2) * Math.SQRT1_2)
      c.lineTo((controllerSize / 2 - borderWidth * 2) * Math.SQRT1_2,
        (controllerSize / 2 + borderWidth) * Math.SQRT1_2)
      c.closePath()
      c.fillStyle = filledColor
      c.fill()

      return cycle
    }

    ctx.clearRect(w * 2 / 3 - 1, h * 2 / 3 - 1, w / 3 + 1, h / 3 + 1)
    if (this.isBusy) return

    ctx.save()
    ctx.translate(w * 0.7, h * 0.7)
    ctx.drawImage(getCycle(), 0, 0)
    ctx.restore()
  }
  printScanner() {
    if (this.scanner.disabled) return

    const { ctx } = this
    const { width: w, height: h } = this.canvas
    const d = w * 2 / 3 / (this.n + 1)

    ctx.save()
    ctx.translate(d / 2, d / 2)
    ctx.fillStyle = this.scanner.error ? this.theme.wrongColor : this.theme.correctColor
    ctx.globalAlpha = 0.5
    if (this.scanner.direction === 'row') {
      ctx.fillRect(0, d * this.scanner.i, w, d)
    } else if (this.scanner.direction === 'column') {
      ctx.fillRect(d * this.scanner.i, 0, d, h)
    }
    ctx.restore()
  }
}
