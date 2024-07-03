import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View, StyleSheet, LayoutChangeEvent } from 'react-native'
import Reanimated, {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  useDerivedValue,
  cancelAnimation,
  withRepeat,
  withSequence,
  withTiming,
  withDelay,
  withSpring,
} from 'react-native-reanimated'
import { GestureDetector } from 'react-native-gesture-handler'

import {
  Canvas,
  runSpring,
  SkPath,
  LinearGradient,
  Path,
  Skia,
  useValue,
  useComputedValue,
  vec,
  Group,
  PathCommand,
  mix,
  Circle,
  Shadow,
} from '@shopify/react-native-skia'

import type { AnimatedLineGraphProps } from './LineGraphProps'
import { SelectionDot as DefaultSelectionDot } from './SelectionDot'
import {
  createGraphPath,
  createGraphPathWithGradient,
  getGraphPathRange,
  GraphPathRange,
  getXInRange,
  getPointsInRange,
} from './CreateGraphPath'
import { getSixDigitHex } from './utils/getSixDigitHex'
import { usePanGesture } from './hooks/usePanGesture'
import { getYForX } from './GetYForX'
import { hexToRgba } from './utils/hexToRgba'

const INDICATOR_RADIUS = 7
const INDICATOR_BORDER_MULTIPLIER = 1.3
const INDICATOR_PULSE_BLUR_RADIUS_SMALL =
  INDICATOR_RADIUS * INDICATOR_BORDER_MULTIPLIER
const INDICATOR_PULSE_BLUR_RADIUS_BIG =
  INDICATOR_RADIUS * INDICATOR_BORDER_MULTIPLIER + 20

export function AnimatedLineGraph({
  points: allPoints,
  colors,
  gradientFillColors,
  lineThickness = 1.5,
  range,
  enableFadeInMask,
  enablePanGesture = false,
  onPointSelected,
  canvasStyle,
  containerStyle,
  onGestureStart,
  onGestureEnd,
  panGestureDelay = 300,
  SelectionDot = DefaultSelectionDot,
  enableIndicator = false,
  indicatorPulsating = false,
  horizontalPadding = enableIndicator
    ? Math.ceil(INDICATOR_RADIUS * INDICATOR_BORDER_MULTIPLIER)
    : 0,
  verticalPadding = lineThickness,
  TopAxisLabel,
  BottomAxisLabel,
  ...props
}: AnimatedLineGraphProps): React.ReactElement {
  const [width, setWidth] = useState(0)
  const [height, setHeight] = useState(0)
  const interpolateProgress1 = useValue(0)
  const interpolateProgresses = Array(allPoints.length).fill(0).map((_, index) => useValue(0))
  const [panned, setPanned] = useState(false);

  const { gesture, isActive, x } = usePanGesture({
    enabled: enablePanGesture,
    holdDuration: panGestureDelay,
  })
  const circleXs = Array(allPoints.length).fill(0).map((_, idx) => useSharedValue(0))
  const circleYs = Array(allPoints.length).fill(0).map((_, idx) => useSharedValue(0))
  const pathEnds = Array(allPoints.length).fill(0).map((_, idx) => useSharedValue(1))
  const indicatorRadius = useSharedValue(enableIndicator ? INDICATOR_RADIUS : 0)
  const indicatorBorderRadius = useDerivedValue(
    () => indicatorRadius.value * INDICATOR_BORDER_MULTIPLIER
  )

  const pulseTrigger = useDerivedValue(() => (isActive.value ? 1 : 0))
  const indicatorPulseAnimation = useSharedValue(0)
  const indicatorPulseRadius = useDerivedValue(() => {
    if (pulseTrigger.value === 0) {
      return mix(
        indicatorPulseAnimation.value,
        INDICATOR_PULSE_BLUR_RADIUS_SMALL,
        INDICATOR_PULSE_BLUR_RADIUS_BIG
      )
    }
    return 0
  })
  const indicatorPulseOpacity = useDerivedValue(() => {
    if (pulseTrigger.value === 0) {
      return mix(indicatorPulseAnimation.value, 1, 0)
    }
    return 0
  })

  const positions = pathEnds.map((_, index) => {
   return useDerivedValue(() => [
      0,
      Math.min(0.15, pathEnds[index].value),
      pathEnds[index].value,
      pathEnds[index].value,
      1,
    ])
  });

  const onLayout = useCallback(
    ({ nativeEvent: { layout } }: LayoutChangeEvent) => {
      setWidth(Math.round(layout.width))
      setHeight(Math.round(layout.height))
    },
    []
  )

  const straightLine = useMemo(() => {
    const path = Skia.Path.Make()
    path.moveTo(0, height / 2)
    for (let i = 0; i < width - 1; i += 2) {
      const x = i
      const y = height / 2
      path.cubicTo(x, y, x, y, x, y)
    }

    return path
  }, [height, width])

  const pathsValues = Array(allPoints.length).fill(0).map((_, index) => useValue<{ from?: SkPath; to?: SkPath }>({}))
  const gradientPaths = useValue<{ from?: SkPath; to?: SkPath }>({})
  const pointSelectedIndex = useRef<number>()

  const commands = Array(allPoints.length).fill('').map((item, index) => useSharedValue<PathCommand[]>([]))
  var commandsChanged = Array(allPoints.length).fill('');
  var setCommandsChanged = Array(allPoints.length).fill('');

  allPoints.forEach((points, index) => {
    const [_commandsChanged, _setCommandsChanged] = useState(0)
    commandsChanged[index] = _commandsChanged;
    setCommandsChanged[index] = _setCommandsChanged;
  });

  const pathRanges: Array<GraphPathRange> = allPoints.map((_points, index) => {
    return useMemo(
      () => getGraphPathRange(allPoints[index], range),
      [_points, range]
    )
  });

  const pointsInRanges = allPoints.map((_points, index) => {
    return useMemo(
      () => getPointsInRange(allPoints[index], pathRanges[index]),
      [_points, range]
    )
  });

  const drawingWidth = useMemo(
    () => width - 2 * horizontalPadding,
    [horizontalPadding, width]
  )

  const lineWidths = allPoints.map((_points, index) => {
    return useMemo(() => {
      const lastPoint = pointsInRanges[index][pointsInRanges[index].length - 1]

      if (lastPoint == null) return drawingWidth

      return Math.max(getXInRange(drawingWidth, lastPoint.date, pathRanges[index].x), 0)
    }, [drawingWidth, pathRanges[index].x, pointsInRanges[index]])
  });

  const indicatorXs = lineWidths.map((lineWidth) => {
    return useDerivedValue(
      () => Math.floor(lineWidth) + horizontalPadding
    )
  });
  const indicatorYs = commands.map((command, index) => {
    return useDerivedValue(
      () => getYForX(commands[index].value, indicatorXs[index].value) || 0
    )
  });

  const indicatorPulseColor = useMemo(() => hexToRgba(colors[0], 0.4), [colors[0]])

  const shouldFillGradient = gradientFillColors != null

  useEffect(() => {
    if (height < 1 || width < 1) {
      // view is not yet measured!
      return
    }
    var emptyPoints = pointsInRanges.filter((points) => points.length < 1)
    if (emptyPoints.length > 0) {
      // points are still empty!
      return
    }

    let paths = Array(allPoints.length).fill(0)
    let _gradientPaths = Array(allPoints.length).fill(null)

    const createGraphPathProps = allPoints.map((points, index) => {
      return {
        pointsInRange: pointsInRanges[index],
        range: pathRanges[index],
        horizontalPadding,
        verticalPadding,
        canvasHeight: height,
        canvasWidth: width,
      }
    });

    if (shouldFillGradient) {
      const { path: pathNew, gradientPath: gradientPathNew } =
        createGraphPathWithGradient(createGraphPathProps[0])

      paths[0] = pathNew
      gradientPaths[0] = gradientPathNew
    } else {
      createGraphPathProps.forEach((props, index) => {
        paths[index] = createGraphPath(createGraphPathProps[index])
      });
    }

    paths.forEach((path, index) => {
      commands[index].value = paths[index].toCmds()
    });

    if (_gradientPaths[0] != null) {
      const previous = _gradientPaths[0].current
      let from: SkPath = previous.to ?? straightLine
      if (previous.from != null && interpolateProgresses[0].current < 1)
        from =
          from.interpolate(previous.from, interpolateProgresses[0].current) ?? from

      if (gradientPaths[0].isInterpolatable(from)) {
        gradientPaths[0].current = {
          from,
          to: _gradientPaths[0],
        }
      } else {
        gradientPaths[0].current = {
          from: _gradientPaths[0],
          to: _gradientPaths[0],
        }
      }
    }

    const previousValues = pathsValues.map(path => path.current);
    let fromValues: SkPath[] = previousValues.map(previousValue => previousValue.to ?? straightLine)

    previousValues.forEach((previousValue, index) => {
      if (previousValue.from != null && interpolateProgresses[index].current < 1)
        fromValues[index] =
          fromValues[index].interpolate(previousValue.from, interpolateProgresses[index].current) ?? fromValues[index]
    });


    paths.forEach((path, index) => {
      if (path.isInterpolatable(fromValues[index])) {
        pathsValues[index].current = {
          from: fromValues[index],
          to: paths[index],
        }
      } else {
        pathsValues[index].current = {
          from: paths[index],
          to: paths[index],
        }
      }
    });

    commandsChanged.forEach((_commandsChanged, index) => {
      setCommandsChanged[index](_commandsChanged[index] + 1)
    });

    interpolateProgresses.forEach((interpolateProgress, index) => {
      runSpring(
        interpolateProgresses[index],
        { from: 0, to: 1 },
        {
          mass: 1,
          stiffness: 100,
          damping: 200,
          velocity: 50,
        }
      )
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    height,
    horizontalPadding,
    interpolateProgresses,
    pathRanges,
    pathsValues,
    shouldFillGradient,
    gradientPaths,
    pointsInRanges,
    range,
    straightLine,
    verticalPadding,
    width,
  ])

  const gradientColorsValues = colors.map((color, index) => {
    return useMemo(() => {
      if (enableFadeInMask) {
        return [
          `${getSixDigitHex(color)}00`,
          `${getSixDigitHex(color)}ff`,
          `${getSixDigitHex(color)}ff`,
          `${getSixDigitHex(color)}33`,
          `${getSixDigitHex(color)}33`,
        ]
      }
      return [
        color,
        color,
        color,
        `${getSixDigitHex(color)}33`,
        `${getSixDigitHex(color)}33`,
      ]
    }, [color, enableFadeInMask])
  });
  
  const paths = pathsValues.map((pathValue, index) => {
    return useComputedValue(
      () => {
        const from = pathsValues[index].current.from ?? straightLine
        const to = pathsValues[index].current.to ?? straightLine

        return to.interpolate(from, interpolateProgresses[index].current)
      },
      // RN Skia deals with deps differently. They are actually the required SkiaValues that the derived value listens to, not react values.
      [interpolateProgresses[index]]
    )
  });
  
  const gradientPath = useComputedValue(
    () => {
      const from = gradientPaths.current.from ?? straightLine
      const to = gradientPaths.current.to ?? straightLine

      return to.interpolate(from, interpolateProgresses[0].current)
    },
    // RN Skia deals with deps differently. They are actually the required SkiaValues that the derived value listens to, not react values.
    [interpolateProgresses]
  )

  const stopPulsating = useCallback(() => {
    cancelAnimation(indicatorPulseAnimation)
    indicatorPulseAnimation.value = 0
  }, [indicatorPulseAnimation])

  const startPulsating = useCallback(() => {
    indicatorPulseAnimation.value = withRepeat(
      withDelay(
        1000,
        withSequence(
          withTiming(1, { duration: 1100 }),
          withTiming(0, { duration: 0 }), // revert to 0
          withTiming(0, { duration: 1200 }), // delay between pulses
          withTiming(1, { duration: 1100 }),
          withTiming(1, { duration: 2000 }) // delay after both pulses
        )
      ),
      -1
    )
  }, [indicatorPulseAnimation])

  const setFingerPoints = allPoints.map((_, index) => {
    return useCallback(
      (fingerX: number) => {
        const fingerXInRange = Math.max(fingerX - horizontalPadding, 0)

        const idx = Math.round(
          (fingerXInRange /
            getXInRange(
              drawingWidth,
              pointsInRanges[index][pointsInRanges[index].length - 1]!.date,
              pathRanges[index].x
            )) *
            (pointsInRanges[index].length - 1)
        )
        const pointIndex = Math.min(Math.max(idx, 0), pointsInRanges[index].length - 1)

        if (pointSelectedIndex.current !== pointIndex) {
          const dataPoint = pointsInRanges[index][pointIndex]
          pointSelectedIndex.current = pointIndex

          if (dataPoint != null) {
            onPointSelected?.(dataPoint, index)
          }
        }
      },
      [
        drawingWidth,
        horizontalPadding,
        onPointSelected,
        pathRanges[index].x,
        pointsInRanges[index],
      ]
    )
  });

  const setFingerXs = allPoints.map((_, index) => {
    return useCallback(
    (fingerX: number) => {
      'worklet'

      const y = getYForX(commands[index].value, fingerX)

      if (y != null) {
        circleXs[index].value = fingerX
        circleYs[index].value = y
      }

      if (isActive.value) {
        pathEnds[index].value = (fingerX / width)
      }
    },
    // pathRange.x must be extra included in deps otherwise onPointSelected doesn't work, IDK why
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [circleXs[index], circleYs[index], isActive, pathEnds[index], pathRanges[index].x, width, commands[index]]
  )
  });

  const setIsActive = useCallback(
    (active: boolean) => {
      indicatorRadius.value = withSpring(!active ? INDICATOR_RADIUS : 0, {
        mass: 1,
        stiffness: 1000,
        damping: 50,
        velocity: 0,
      })

      if (active) {
        setPanned(true);
        onGestureStart?.()
        stopPulsating()
      } else {
        onGestureEnd?.()
        //pathEnd.value = 1
        startPulsating()
      }
    },
    [
      indicatorRadius,
      onGestureEnd,
      onGestureStart,
      pathEnds[0],
      startPulsating,
      stopPulsating,
    ]
  )

  useAnimatedReaction(
    () => x.value,
    (fingerX) => {
      if (isActive.value || fingerX) {
        allPoints.forEach((_, index) => {
          setFingerXs[index](fingerX)
          runOnJS(setFingerPoints[index])(fingerX)
        });
      }
    },
    [isActive, setFingerXs, width, x]
  )

  useAnimatedReaction(
    () => isActive.value,
    (active) => {
      runOnJS(setIsActive)(active)
    },
    [isActive, setIsActive]
  )

  useEffect(() => {
    allPoints.forEach((_, index) => {
      if (pointsInRanges[index].length !== 0 && commands[index].value.length !== 0) {
        pathEnds[index].value = 1
      }
    });
  }, [commands, pathEnds, pointsInRanges.map(p => p.length)])

  useEffect(() => {
    if (indicatorPulsating) {
      startPulsating()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicatorPulsating])

  const axisLabelContainerStyle = {
    paddingTop: TopAxisLabel != null ? 20 : 0,
    paddingBottom: BottomAxisLabel != null ? 20 : 0,
  }

  const indicatorsVisible = commandsChanged.map((changed) => {
    return enableIndicator && changed > 0
  });

  return (
    <View {...props}>
      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.container, axisLabelContainerStyle, containerStyle]}>
          {/* Top Label (max price) */}
          {TopAxisLabel != null && (
            <View style={styles.axisRow}>
              <TopAxisLabel />
            </View>
          )}

          {/* Actual Skia Graph */}
          <View style={styles.container} onLayout={onLayout}>
            {/* Fix for react-native-skia's incorrect type declarations */}
            <Canvas style={[styles.svg, canvasStyle]}>
              {paths.map((path, index) => {
                return (
                  <Group key={index}>
                    <Path
                      path={path}
                      strokeWidth={lineThickness}
                      style="stroke"
                      strokeJoin="round"
                      strokeCap="round"
                    >
                      <LinearGradient
                        start={vec(0, 0)}
                        end={vec(width, 0)}
                        colors={gradientColorsValues[index]}
                        positions={positions[index]}
                      />
                    </Path>

                    {shouldFillGradient && (
                      <Path
                        path={gradientPath}
                      >
                        <LinearGradient
                          start={vec(0, 0)}
                          end={vec(0, height)}
                          colors={gradientFillColors}
                        />
                      </Path>
                    )}
                  </Group>
                );
              })}

              {allPoints.map((_, index) => {
                return (
                  SelectionDot != null && (
                    <SelectionDot
                      key={index}
                      isActive={isActive}
                      color={colors[index]}
                      lineThickness={lineThickness}
                      circleX={circleXs[index]}
                      circleY={circleYs[index]}
                    />
                  )
                );
              })}

            </Canvas>
          </View>

          {/* Bottom Label (min price) */}
          {BottomAxisLabel != null && (
            <View style={styles.axisRow}>
              <BottomAxisLabel />
            </View>
          )}
        </Reanimated.View>
      </GestureDetector>
    </View>
  )
}

const styles = StyleSheet.create({
  svg: {
    flex: 1,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  container: {
    flex: 1,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  axisRow: {
    height: 17,
  },
})

