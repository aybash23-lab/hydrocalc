package com.hydrocalc.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hydrocalc.app.calc.HydroCalculator
import com.hydrocalc.app.calc.HydroCalculator.CalcInput
import com.hydrocalc.app.calc.Method
import com.hydrocalc.app.calc.PE100_DN_MM
import com.hydrocalc.app.calc.PE100_SDRS
import com.hydrocalc.app.calc.PE100_SDR_LABELS
import com.hydrocalc.app.calc.STANDARD_NOMINAL_DIAMETERS_MM
import com.hydrocalc.app.calc.TubeMaterial
import com.hydrocalc.app.calc.pe100WallThickness
import java.util.Locale
import kotlin.math.floor
import kotlin.math.sqrt

/**
 * Дополнительные инструменты:
 *  1) подбор диаметра по допустимым потерям давления;
 *  2) расчёт гидроудара (формула Жуковского).
 */

private val RU = Locale("ru", "RU")

private fun fmt2(x: Double): String = String.format(RU, "%.2f", x)

private fun fmtD(x: Double): String =
    if (x == floor(x)) x.toInt().toString() else String.format(RU, "%.1f", x)

private fun fmtMeters(pa: Double): String = fmt2(pa / 9807.0)

// =====================================================================
// Подбор диаметра по допустимым потерям
// =====================================================================

/** Кандидат: один стандартный диаметр (для ПЭ100 — сочетание DN × SDR) */
data class PickerCandidate(
    val isPe100: Boolean,
    val dnMm: Int,              // ПЭ100: DN; для остальных — условный проход
    val sdrIndex: Int,          // ПЭ100: индекс SDR; иначе −1
    val wallMm: Double,         // ПЭ100: толщина стенки; иначе 0
    val innerDiameterMm: Double,
    val velocity: Double,
    val dpPa: Double            // полные потери с учётом местных (если заданы)
)

data class PickerResult(
    val all: List<PickerCandidate>,
    val suitable: List<PickerCandidate>,
    val best: PickerCandidate?
)

/**
 * Перебирает стандартные диаметры и для каждого считает потери тем же методом,
 * что и основной расчёт. Для ПЭ100 перебираются все сочетания DN × SDR
 * из ГОСТ 18599-2001 (внутренний диаметр = DN − 2·s).
 */
fun pickDiameter(inp: CalcInput, allowablePa: Double, localPct: Int): PickerResult {
    val q = (inp.qText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0) / inp.unit.divisor
    val l = inp.lengthText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    val t = inp.temperatureText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    val ksi = if (inp.method == Method.TEOR)
        inp.sumKsiText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    else 0.0
    val kLocal = if (localPct > 0 && inp.method != Method.TEOR) 1.0 + localPct / 100.0 else 1.0

    fun cand(
        dnMm: Int, sdrIndex: Int, wallMm: Double, innerMm: Double, isPe: Boolean
    ): PickerCandidate {
        val res = HydroCalculator.computeParsed(
            inp.method, inp.material, q, innerMm / 1000.0, l, t, inp.roughness.mm, ksi
        )
        return PickerCandidate(
            isPe100 = isPe, dnMm = dnMm, sdrIndex = sdrIndex, wallMm = wallMm,
            innerDiameterMm = innerMm, velocity = res.velocity, dpPa = res.dpPa * kLocal
        )
    }

    val candidates = ArrayList<PickerCandidate>()
    if (inp.material == TubeMaterial.PE100) {
        for (dn in PE100_DN_MM) {
            for (si in PE100_SDRS.indices) {
                val s = pe100WallThickness(dn, PE100_SDRS[si]) ?: continue
                candidates.add(cand(dn, si, s, dn - 2.0 * s, true))
            }
        }
    } else {
        for (dn in STANDARD_NOMINAL_DIAMETERS_MM) {
            candidates.add(cand(dn, -1, 0.0, dn.toDouble(), false))
        }
    }
    val sorted = candidates.sortedBy { it.innerDiameterMm }
    val suitable = sorted.filter { it.dpPa <= allowablePa }
    return PickerResult(all = sorted, suitable = suitable, best = suitable.firstOrNull())
}

private fun describeCandidate(c: PickerCandidate): String =
    if (c.isPe100)
        "DN ${c.dnMm} · ${PE100_SDR_LABELS[c.sdrIndex]} · d = ${fmtD(c.innerDiameterMm)} мм"
    else
        "Ду ${c.dnMm} мм"

private fun describeRow(c: PickerCandidate): String =
    if (c.isPe100)
        "DN ${c.dnMm} · ${PE100_SDR_LABELS[c.sdrIndex]} · d ${fmtD(c.innerDiameterMm)} мм · " +
                "v ${fmt2(c.velocity)} м/с · ΔP ${fmtMeters(c.dpPa)} м"
    else
        "Ду ${c.dnMm} · v ${fmt2(c.velocity)} м/с · ΔP ${fmtMeters(c.dpPa)} м"

/** Секция «Подбор диаметра по допустимым потерям» */
@Composable
fun DiameterPickerSection(inp: CalcInput, localPct: Int) {
    var allowableText by remember { mutableStateOf("2") }
    val allowable = allowableText.trim().replace(',', '.').toDoubleOrNull()

    SectionCard("Подбор диаметра по допустимым потерям") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Перебирает стандартные диаметры и показывает те, при которых потери давления " +
                        "на участке не превысят заданную величину. Метод, материал, расход, длина " +
                        "и температура берутся из основного расчёта.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            NumberField(
                label = "Допустимые потери давления",
                value = allowableText,
                onValueChange = { allowableText = it },
                suffix = "м вод. ст."
            )
            if (allowable == null || allowable <= 0.0) {
                Text(
                    "Укажите допустимые потери — положительное число",
                    color = ZoneRed,
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                val pick = remember(inp, localPct, allowableText) {
                    pickDiameter(inp, allowable * 9807.0, localPct)
                }
                if (localPct > 0 && inp.method != Method.TEOR) {
                    Text(
                        "Учтены местные сопротивления: +$localPct %",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                Text(
                    if (inp.material == TubeMaterial.PE100)
                        "Перебираются все сочетания DN × SDR из ГОСТ 18599-2001 " +
                                "(внутренний диаметр = DN − 2·s)."
                    else
                        "Перебираются условные проходы 15–2000 мм; " +
                                "внутренний диаметр принят равным условному проходу.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                val best = pick.best
                if (best != null) {
                    ResultRow("Наименьший подходящий", describeCandidate(best), emphasize = true)
                    ResultRow(
                        "Скорость воды в нём",
                        fmt2(best.velocity) + " м/с",
                        warn = best.velocity < HydroCalculator.V_OPT_MIN ||
                                best.velocity > HydroCalculator.V_OPT_MAX
                    )
                    ResultRow(
                        "Потери давления на участке",
                        fmtMeters(best.dpPa) + " м вод. ст.",
                        emphasize = true
                    )
                } else {
                    val biggest = pick.all.last()
                    Text(
                        "Ни один диаметр из справочника не укладывается в допустимые потери. " +
                                "Минимум, который дают самые большие трубы (" +
                                describeCandidate(biggest) + "): " +
                                fmtMeters(biggest.dpPa) + " м вод. ст. " +
                                "Увеличьте допустимые потери, уменьшите расход или длину.",
                        color = ZoneRed,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                if (pick.suitable.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "Все подходящие (от меньшего к большему):",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                    val shown = pick.suitable.take(20)
                    shown.forEach { c ->
                        val outOfZone = c.velocity < HydroCalculator.V_OPT_MIN ||
                                c.velocity > HydroCalculator.V_OPT_MAX
                        Text(
                            describeRow(c),
                            style = MaterialTheme.typography.bodySmall,
                            color = if (outOfZone) ZoneAmber else MaterialTheme.colorScheme.onSurface
                        )
                    }
                    if (pick.suitable.size > shown.size) {
                        Text(
                            "… и ещё ${pick.suitable.size - shown.size} вариантов большего диаметра",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }
        }
    }
}

// =====================================================================
// Гидроудар
// =====================================================================

/** Результат расчёта гидроудара */
data class HammerResult(
    val youngPa: Double,      // принятый модуль упругости стенки, Па
    val waveSpeed: Double,    // скорость ударной волны c, м/с
    val phaseTime: Double,    // фаза удара 2L/c, с
    val direct: Boolean,      // true — прямой удар
    val dpPa: Double          // повышение давления, Па
)

/** Модуль упругости материала стенки, Па (кратковременный) */
fun youngModulus(m: TubeMaterial): Double = when (m) {
    TubeMaterial.STEEL_NEW -> 2.06e11
    TubeMaterial.CAST_IRON_NEW -> 1.0e11
    TubeMaterial.STEEL_CAST_OLD -> 2.0e11
    TubeMaterial.PLASTIC_COATED -> 2.0e11
    TubeMaterial.CEMENT_SAND_SPRAYED -> 2.0e11
    TubeMaterial.CEMENT_SAND_CENTRIFUGED -> 2.0e11
    TubeMaterial.POLYMER -> 1.5e9
    TubeMaterial.PE100 -> 1.0e9
    TubeMaterial.GLASS -> 6.0e10
}

/**
 * Гидроудар по Жуковскому: ΔP = ρ·c·v.
 * Скорость волны в упругой трубе: c = c0 / sqrt(1 + K·D/(E·s)),
 * c0 = 1435 м/с, K = 2,06·10⁹ Па (модуль объёмной упругости воды).
 * При T > 2L/c (непрямой удар) — формула Мишо: ΔP = ρ·c·v·(2L/c)/T.
 */
fun waterHammer(
    material: TubeMaterial,
    innerDiameterM: Double,
    wallThicknessM: Double,
    lengthM: Double,
    velocity: Double,
    densityTPerM3: Double,
    closeTimeSec: Double
): HammerResult {
    val ePa = youngModulus(material)
    val kWater = 2.06e9
    val c0 = 1435.0
    val factor = if (wallThicknessM > 0.0)
        sqrt(1.0 + kWater * innerDiameterM / (ePa * wallThicknessM))
    else 1.0
    val c = c0 / factor
    val tPhase = if (c > 0.0 && lengthM > 0.0) 2.0 * lengthM / c else 0.0
    val direct = closeTimeSec <= 0.0 || closeTimeSec <= tPhase
    val k = if (direct) 1.0 else tPhase / closeTimeSec
    val rho = densityTPerM3 * 1000.0
    val dp = rho * c * velocity * k
    return HammerResult(ePa, c, tPhase, direct, dp)
}

/** Секция «Гидроудар» */
@Composable
fun WaterHammerSection(inp: CalcInput, result: HydroCalculator.CalcResult) {
    var tCloseText by remember { mutableStateOf("1") }
    val l = inp.lengthText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    val s = inp.wallThicknessText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    val tClose = tCloseText.trim().replace(',', '.').toDoubleOrNull() ?: 0.0
    val hammer = waterHammer(
        inp.material, result.innerDiameterM, s / 1000.0, l,
        result.velocity, result.ro, tClose
    )

    SectionCard("Гидроудар (повышение давления)") {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                "Скачок давления при резкой остановке потока (формула Жуковского ΔP = ρ·c·v). " +
                        "Скорость, диаметр, длина и материал берутся из основного расчёта.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            NumberField(
                label = "Время закрытия задвижки (0 — мгновенно)",
                value = tCloseText,
                onValueChange = { tCloseText = it },
                suffix = "с"
            )
            ResultRow("Скорость воды из расчёта", fmt3(result.velocity) + " м/с")
            ResultRow(
                "Модуль упругости стенки",
                String.format(RU, "%.2f", hammer.youngPa / 1e9) + " ГПа"
            )
            ResultRow(
                "Скорость ударной волны c",
                String.format(RU, "%.0f", hammer.waveSpeed) + " м/с"
            )
            ResultRow("Фазовое время 2L/c", fmt2(hammer.phaseTime) + " с")
            ResultRow(
                "Характер удара",
                if (hammer.direct) "Прямой (T ≤ 2L/c) — максимальный"
                else "Непрямой (T > 2L/c) — ослабленный",
                emphasize = true
            )
            ResultRow(
                "Повышение давления ΔP",
                String.format(RU, "%,.0f", hammer.dpPa) + " Па (" +
                        String.format(RU, "%,.1f", hammer.dpPa / 1000.0) + " кПа; " +
                        fmt2(hammer.dpPa * 1.0197162e-5) + " кгс/см²)",
                emphasize = true
            )
            ResultRow(
                "Повышение давления ΔP",
                fmtMeters(hammer.dpPa) + " м вод. ст.",
                emphasize = true
            )
            if (tClose <= 0.0) {
                Text(
                    "Задано мгновенное закрытие — показан максимально возможный удар.",
                    style = MaterialTheme.typography.bodySmall,
                    color = ZoneAmber
                )
            }
            if (s <= 0.0) {
                Text(
                    "Толщина стенки не задана — стенка принята абсолютно жёсткой (c = 1435 м/с).",
                    style = MaterialTheme.typography.bodySmall,
                    color = ZoneAmber
                )
            }
            Text(
                "При T > 2L/c отражённая волна успевает вернуться до конца закрытия, " +
                        "и удар ослабляется примерно во столько же раз (формула Мишо).",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (inp.material == TubeMaterial.PE100 || inp.material == TubeMaterial.POLYMER) {
                Text(
                    "Для пластмасс принят кратковременный модуль упругости " +
                            "(ПЭ100 — 1,0 ГПа, полимерные — 1,5 ГПа); " +
                            "вязкое демпфирование дополнительно снижает реальный удар.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}
