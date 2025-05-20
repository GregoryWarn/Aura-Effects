const gmQueue = new foundry.utils.Semaphore();

/**
 * Delete all Active Effects whose UUIDs are provided (ignoring any UUIDs which do NOT correspond to Active Effects)
 * @param {Object} data                 Query input data
 * @param {string[]} data.effectUuids   A list of UUIDs for each Active Effect that should be deleted 
 * @returns {Promise<boolean>}          true
 */
async function deleteEffects({ effectUuids }) {
  const disableAnimation = game.settings.get("ActiveAuras", "disableScrollingText");
  await gmQueue.add(() => {
    const effects = new Set(effectUuids.map(uuid => fromUuidSync(uuid))).filter(e => e instanceof ActiveEffect);
    return Promise.all(effects.map(e => e.delete({ animate: !disableAnimation })));
  });
  return true;
}

/**
 * Create potentially multiple Active Effects on potentially multiple Actors, modifying the provided effects as
 * necessary for "aura effect" treatment and skipping effects which already exist; also choosing best of multiple
 * if a non-stacking effect, so that only one is applied
 * @param {Object<string, string[]>} actorToEffectsMap  An object with Actor UUIDs as keys, and lists of ActiveEffect UUIDs as values
 * @returns {Promise<boolean>}                          true
 */
async function applyAuraEffects(actorToEffectsMap) {
  const disableAnimation = game.settings.get("ActiveAuras", "disableScrollingText");
  await gmQueue.add(() => {
    return Promise.all(Object.entries(actorToEffectsMap).map(([actorUuid, effectUuids]) => {
      const actor = fromUuidSync(actorUuid);
      const allEffects = actor.appliedEffects;
      const effectsToDelete = [];
      const effects = effectUuids.map(uuid => {
        if (allEffects.some(e => e.origin === uuid)) return null;
        const effect = fromUuidSync(uuid);
        if (!effect) return null;
        const effectData = foundry.utils.mergeObject(effect.toObject(), {
          name: effect.system.overrideName?.trim() || effect.name,
          origin: uuid,
          type: effect.getFlag("ActiveAuras", "originalType") ?? "base",
          transfer: false,
          "flags.ActiveAuras.fromAura": true
        });
        if (!effect.system.canStack) {
          const bestValue = new Roll(effect.system.bestFormula.trim() || "0", effect.parent?.getRollData?.()).evaluateSync().total;
          foundry.utils.setProperty(effectData, "flags.ActiveAuras.bestValue", bestValue);
          const existingEffect = allEffects.find(e => e.flags?.ActiveAuras?.fromAura && e.name === effectData.name);
          if (existingEffect) {
            if ((existingEffect.flags.ActiveAuras.bestValue ?? 0) >= bestValue) return null;
            effectsToDelete.push(existingEffect.id);
          }
        }
        if (game.modules.get("dae")?.active) {
          for (const change of effectData.changes) {
            change.value = Roll.replaceFormulaData(change.value, effect.parent?.getRollData?.());
            change.value = change.value.replaceAll("##", "@");
          }
        } else if (effect.system.evaluatePreApply) {
          for (const change of effectData.changes) {
            change.value = Roll.replaceFormulaData(change.value, effect.parent?.getRollData?.());
          }
        }
        return effectData;
      }).filter(e => e).reduce((acc, effect) => {
        const existing = acc.find(e => e.name === effect.name);
        const existingBestValue = existing?.flags.ActiveAuras.bestValue;
        if (existingBestValue === undefined) return [...acc, effect];
        const currBestValue = effect.flags.ActiveAuras.bestValue;
        if (currBestValue > existingBestValue) acc.findSplice(e => e === existing, effect);
        return acc;
      }, []);
      return actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete, { animate: !disableAnimation }).then(() => 
        actor.createEmbeddedDocuments("ActiveEffect", effects, { animate: !disableAnimation })
      );
    }));
  });
  return true;
}

export {
  applyAuraEffects,
  deleteEffects
};