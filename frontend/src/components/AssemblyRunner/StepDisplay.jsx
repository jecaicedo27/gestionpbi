import React from 'react';
import IntroStep from './steps/IntroStep';
import InputStep from './steps/InputStep';
import EmpaqueStep from './steps/EmpaqueStep';
import EnsambleStep from './steps/EnsambleStep';
import OutputStep from './steps/OutputStep';
import ConteoStep from './steps/ConteoStep';
import MarcadoCajasStep from './steps/MarcadoCajasStep';
import CoccionStep from './steps/CoccionStep';
import MedicionStep from './steps/MedicionStep';
import FormacionQCStep from './steps/FormacionQCStep';
import EsferificacionStep from './steps/EsferificacionStep';
import AguaStep from './steps/AguaStep';
import ProteccionGateStep from './steps/ProteccionGateStep';
import PesajeBatchStep from './steps/PesajeBatchStep';
import AdicionBatchStep from './steps/AdicionBatchStep';
import PrintLotStep from './steps/PrintLotStep';
import GConteoCarritosStep from '../GenialityRunner/steps/GConteoCarritosStep';
import GEPremixStep from '../GenialityRunner/steps/GEPremixStep';
import GEBaseLiquidaStep from '../GenialityRunner/steps/GEBaseLiquidaStep';
import GECoccionStep from '../GenialityRunner/steps/GECoccionStep';
import CoccionInversionStep from '../GenialityRunner/steps/CoccionInversionStep';

/**
 * StepDisplay — thin router
 *
 * Receives stepType + all props and renders the correct step component.
 * All logic lives inside the individual step files.
 */
const StepDisplay = (props) => {
    const { stepType } = props;

    if (stepType === 'INTRO') return <IntroStep        {...props} />;
    if (stepType === 'INPUT') return <InputStep        {...props} />;
    if (stepType === 'EMPAQUE') return <EmpaqueStep      {...props} />;
    if (stepType === 'MARCADO_CAJAS') return <MarcadoCajasStep {...props} />;
    if (stepType === 'ENSAMBLE') return <EnsambleStep     {...props} />;
    if (stepType === 'OUTPUT') return <OutputStep       {...props} />;
    if (stepType === 'CONTEO') return <ConteoStep       {...props} />;
    if (stepType === 'COCCION') return <CoccionStep      {...props} />;
    if (stepType === 'MEDICION') return <MedicionStep     {...props} />;
    if (stepType === 'FORMACION_QC') return <FormacionQCStep {...props} />;
    if (stepType === 'ESFERIFICACION') return <EsferificacionStep {...props} />;
    if (stepType === 'AGUA') return <AguaStep {...props} />;
    if (stepType === 'PROTECCION_GATE') return <ProteccionGateStep {...props} />;
    if (stepType === 'PESAJE_BATCH') return <PesajeBatchStep {...props} />;
    if (stepType === 'ADICION_BATCH') return <AdicionBatchStep {...props} />;
    if (stepType === 'IMPRESION_LOTE') return <PrintLotStep {...props} />;

    // Geniality steps
    if (stepType === 'G_CONTEO_CARRITOS') return <GConteoCarritosStep {...props} />;

    // Geniality Escarchado steps
    if (stepType === 'GE_PREMIX') return <GEPremixStep {...props} />;
    if (stepType === 'GE_BASE_LIQUIDA') return <GEBaseLiquidaStep {...props} />;
    if (stepType === 'GE_COCCION') return <GECoccionStep {...props} />;
    if (stepType === 'COCCION_INVERSION') return <CoccionInversionStep {...props} />;

    return null;
};

export default StepDisplay;
