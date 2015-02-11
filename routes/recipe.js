var actions = require('./actions.js');
var notifications = require('../util/notifications.js');
var model = require('../domain/model.js');
var observer = require("./observer");
var Arrays = require('../public/js/util/util.js').Arrays;

function processFilter(filter) {
    if ( filter && filter.searchCriteria ) {
        filter.$or = [
            {NAME: {"$regex": filter.searchCriteria,"$options": 'i'}},
            {code: {"$regex": filter.searchCriteria,"$options": 'i'}},
            {BREWER: {"$regex": filter.searchCriteria,"$options": 'i'}},
            {'STYLE.NAME': {"$regex": filter.searchCriteria,"$options": 'i'}},
            {tags: filter.searchCriteria}

        ];
        delete filter.searchCriteria;
    }
    return filter;
}

exports.findCollaborated = function (req, res) {
    model.Recipe.find({collaborators: { $in : [req.session.user_id] } }).populate('owner').limit(req.query.limit).exec(function(err,results) {
        res.send(results);
    });
};

// exports.findPublic = function (req, res) {
//     //where('owner').ne(req.session.user_id).
//     model.Recipe.find({isPublic:true}).populate('owner').sort('-publishDate').limit(req.query.limit).skip(req.query.skip).exec(function(err,results) {
//         res.send(results);
//     });
// };

exports.findPublic = function(req, res) {
    var filter = processFilter(req.query.filter);

    filter = filter||{};
    filter.isPublic = true;

    console.log("filter",JSON.stringify(filter));
    model.Recipe.find(filter,'NAME tags STYLE OG ABV CALCCOLOUR CALCIBU BATCH_SIZE BREWER owner publishDate')
        .limit(req.query.limit)
        .skip(req.query.skip)
        .sort(req.query.sort)
        // .sort('-publishDate')
        .populate('owner','name _id')
        .exec(function(err,results) {
            res.send(results);
    });
};

exports.countPublic = function(req, res) {
    var filter = processFilter(req.query.filter);

    filter = filter||{};
    filter.isPublic = true;

    console.log("filter(count)", JSON.stringify(filter));
    model.Recipe.count(filter)
        .exec(function(err,results) {
            res.send({count:results});
    });
};

// exports.countPublic = function (req, res) {
//     //where('owner').ne(req.session.user_id).
//     model.Recipe.count({isPublic:true}).exec(function(err,results) {
//         res.send({count:results});
//     });
// };


exports.findByUser = function(req, res) {
    model.Recipe.find({owner:req.params.id,isPublic:true}).sort('-publishDate').exec(function(err,results) {
        res.send(results);
    });
};

// exports.findAll = function(req, res) {
//     model.Recipe.find({owner:req.session.user_id}).sort('-date').exec(function(err,results) {
//         res.send(results);
//     });
// };
exports.findAll = function(req, res) {
    var filter = processFilter(req.query.filter);

    filter = filter||{};
    filter.owner = req.session.user_id;

    console.log("filter",JSON.stringify(filter));
    model.Recipe.find(filter,'NAME code tags STYLE OG ABV CALCCOLOUR CALCIBU BATCH_SIZE BREWER owner publishDate isPublic')
        .limit(req.query.limit)
        .skip(req.query.skip)
        .sort(req.query.sort)
        .populate('owner','name _id')
        .exec(function(err,results) {
            res.send(results);
    });
};

exports.countAll = function(req, res) {
    var filter = processFilter(req.query.filter);

    filter = filter||{};
    filter.owner = req.session.user_id;

    console.log("filter(count)", JSON.stringify(filter));
    model.Recipe.count(filter)
        .exec(function(err,results) {
            res.send({count:results});
    });
};

exports.myTags = function(req, res) {
    model.Recipe.aggregate(
        [
            {$match:{tags:{$exists:true},owner:req.session.user_id }},
            {$unwind:'$tags'},
            {$group:{_id:'$tags',total:{$sum:1}}},
            {$sort:{total:-1}}
        ],
        function(err, result) {
            if ( err ) {
                res.status(500).send(err);
            } else {
                res.send(result);
            }
        }
    );
};

exports.publicStyles = function(req, res) {
    model.Recipe.aggregate(
        [
            {$match:{'STYLE.NAME':{$exists:true},'isPublic':true }},
            {$group:{_id:'$STYLE.NAME',total:{$sum:1}}},
            {$sort:{total:-1}}
        ],
        function(err, result) {
            if ( err ) {
                res.status(500).send(err);
            } else {
                res.send(result);
            }
        }
    );
};

exports.get = function(req, res) {
    model.Recipe.findOne({_id:req.params.id}).populate('collaborators').populate('owner').populate('cloneFrom').exec(function(err,results) {
        res.send(results);
    });
};

exports.getComments = function(req,res) {
    model.Recipe.findOne({_id:req.params.id}).exec(function(err,results) {
        res.send(results.comments);
    });
};

exports.remove= function(req, res) {
    model.Recipe.findByIdAndRemove(req.params.id,function(err,results) {
        res.send(results);
        actions.log(req.session.user_id, "REMOVE_RECIPE","NAME: '"+results.NAME+"'. recipe_id: "+results._id);
    });
};


function generateId(name,user_id) {
    return name.replace(/[^a-z0-9]/ig, '') + "-" + user_id + "-" + (new Date()).getTime();
}

exports.addComment = function(req,res) {
    model.Recipe.findOne({_id:req.body.recipe_id}).exec(function(err,recipe) {
        var newComment = {
            _id: req.session.user_id + "_" + new Date().getTime(),
            user_id: req.session.user_id,
            name: req.session.user_name,
            text: req.body.text,
            date: new Date()
        };
        recipe.comments.push(newComment);
        recipe.save(function() {
            res.send(recipe.comments);
            require("./push").emit("RECIPE_COMMENT_ADD_" + recipe._id,newComment);
        });


        //LOG action
        actions.log(req.session.user_id, "ADD_COMMENT","NAME: '"+recipe.NAME+"'. recipe_id: "+recipe._id);

        //Add Notification
        notifications.notifyCommentOnRecipe(
            recipe.owner,
            req.session.user_id,
            req.session.user_name ,
            recipe._id,
            recipe.NAME);
        notifications.notifyCommentOnFavorite(
            recipe,
            req.session.user_id,
            req.session.user_name);

        // observer.change("RECIPE_COMMENT_ADD_" + recipe._id);
    });
};

exports.deleteComment = function(req,res) {
    model.Recipe.findOne({_id:req.body.recipe_id}).exec(function(err,recipe) {
        Arrays.remove(recipe.comments,req.body.comment,function(comment,iter){
            return comment._id == iter._id ? 0 : -1;
        });
        recipe.save( function() {
            res.send(recipe.comments);
            require("./push").emit("RECIPE_COMMENT_REMOVE_" + recipe._id,req.body.comment);
        });

        actions.log(req.session.user_id, "REMOVE_COMMENT","NAME: '"+recipe.NAME+"'. recipe_id: "+recipe._id);
    });
};

exports.save = function(req, res) {

    function callback(err,s){
        if (err) {
            console.log("error", err);
        }
//        console.log("response bottling",s.bottling);
        notifications.notifyUpdateFavorite(s);
        notifications.notifyUpdateCollaborators(s,req.session.user_id,req.session.user_name);
        res.send(s);

        //Update tags
        for (var i=0; i<s.tags.length; i++) {
            var tag = new model.Tag({_id:s.tags[i]});
            tag.save();
        }
    }
    if (!req.body._id) {
        var recipe = new model.Recipe(req.body);
        var id = generateId(req.body.NAME,req.session.user_id);
        recipe._id = id;
        recipe.owner = req.session.user_id;
        if ( req.body.isPublic ) {
            recipe.publishDate = new Date();
        }
        recipe.version.push({
            number: 1,
            user_id: req.session.user_id,
            timeStamp: new Date(),
            user_name: req.session.user_name
        });
        recipe.save(callback);

        /**
         * Si la estoy clonando de otra, debo hacerle update para
         * poner que fue clonada por mi.
         */
        if (recipe.cloneFrom ) {
            model.Recipe.findOne({_id:recipe.cloneFrom}).exec(function(err,original){
                original.clonedBy.push({
                    _id: req.session.user_id,
                    name: req.session.user_name,
                    recipe_id: id
                });
                original.save();
                notifications.notifyRecipeCloned(original.owner,recipe,req.session.user_id,req.session.user_name,original.NAME);
            });

        }
        actions.log(req.session.user_id, "ADD_RECIPE","NAME: '"+req.body.NAME+"'. recipe_id: "+id);
        if ( req.body.isPublic ) {
            notifications.notifyOnPublish(req.body.NAME,id,req.session.user_name,req.session.user_id);
        }
        notifications.notifyNewCollaborators(recipe,recipe.collaborators);
    } else {


        var id = req.body._id;
        delete req.body._id;
        req.body.owner = req.body.owner._id;
        for ( var i=0; i<req.body.collaborators.length; i++ ) {
            req.body.collaborators[i] = req.body.collaborators[i]._id;
        }
        if (req.body.cloneFrom) {
            req.body.cloneFrom = req.body.cloneFrom._id;
        }
        req.body.modificationDate = new Date();
        //console.log("UPDATE POST", req.body);
//        model.Recipe.findByIdAndUpdate(id,req.body).populate('owner').exec(callback);
        model.Recipe.findById(id).exec(function (err,old) {
            //Verifico los permisos de la receta contra la version guardada de la misma
            if ( old.owner != req.session.user_id ) {
                if ( old.collaborators.indexOf(req.session.user_id) == -1 ) {
                    res.send(500,{error: "No tiene permisos para modificar esta receta"});
                    return;
                }
            }

            var oldNumber = 0;
            var actualNumber = 0;
            if ( old.version.length != 0 ) {
                oldNumber = old.version[old.version.length-1].number;

            }
            if ( req.body.version.length != 0 ) {
                actualNumber = req.body.version[req.body.version.length-1].number;
            }


            if ( oldNumber != actualNumber ) {
                res.send(501,{
                    error: "La receta fue actualizada por " + old.version[old.version.length-1].user_name + ". debe actualizar (F5) antes de proseguir, perdera los cambios hechos.",
                    recipe: old
                });
                return;
            }

            req.body.version.push({
                number: oldNumber+1,
                user_id: req.session.user_id,
                timeStamp: new Date(),
                user_name: req.session.user_name
            });

            //The comments is not update in this operation, only add/remove in other operation. Justo take del commments of previous version.

            req.body.comments = old.comments;

            if ( !old.isPublic && req.body.isPublic ) {
                notifications.notifyOnPublish(req.body.NAME,id,req.session.user_name,req.session.user_id);
                req.body.publishDate = new Date();
            }

            //Compruebo los colaboradores nuevos
            var newCollaborators = [];
            for( var i=0; i<req.body.collaborators.length; i++ ) {
                var col_id = req.body.collaborators[i];
                if ( old.collaborators.indexOf(col_id) == -1 ) {
                    newCollaborators.push(col_id);
                }
            }
            notifications.notifyNewCollaborators(old,newCollaborators);


            model.Recipe.findByIdAndUpdate(id,req.body).populate('owner').populate('collaborators').populate('cloneFrom').exec(callback);
        });

        actions.log(req.session.user_id, "UPDATE_RECIPE","NAME: '"+req.body.NAME+"'. recipe_id: "+id);
    }

};

exports.publish = function(req, res) {
    model.Recipe.findOne({_id:req.params.id}).populate('owner').exec(function(err,recipe) {
        recipe.isPublic = req.query.isPublic;
        if (recipe.isPublic) {
            recipe.publishDate = new Date();
        }
        recipe.save(function(err) {
            if ( err ) {
                res.send(500,{error: 'Error al publicar la receta'});
            } else {
                notifications.notifyOnPublish(recipe.NAME,recipe._id,req.session.user_name,req.session.user_id);
                res.send(recipe);
            }
        });
    });
};


exports.stats = function(req, res) {

    var values = {
        publics: null,
        owns: null,
        collaborations: null
    };

    function complete() {
        if ( values.publics != null && values.owns != null && values.collaborations != null ) {
            res.send(values);
        }
    }

    model.Recipe.count({isPublic:true},function(err, publicCount) {
        values.publics = publicCount;
        complete();
    });

    model.Recipe.count({owner:req.session.user_id},function(err,ownCount) {
        values.owns = ownCount;
        complete();
    });

    model.Recipe.count({collaborators: { $in : [req.session.user_id] } },function(err,collabCount) {
        values.collaborations = collabCount;
        complete();
    });
};

exports.fireFermentationNotification = function() {
    model.Recipe.find({"fermentation.alertTime":{$exists:true}}).exec(function(err, recipes) {
        console.log("POSIBLES", recipes.length);
        var nowTime = new Date().getTime();

        for( var i=0; i<recipes.length; i++ ) {
            var recipe = recipes[i];

            //Solo si tiene fecha de inicio estimada
            if ( recipe.fermentation.estimateDate ) {
                console.log("estimateDate", recipe.fermentation.estimateDate);
                var timeFromEstimate = recipe.fermentation.estimateDate.getTime();

                var previousStage = null;
                for ( var j=0; j<recipe.fermentation.stages.length; j++ ) {
                    var stage = recipe.fermentation.stages[j];

                    if ( !stage.alertDone && timeFromEstimate<=nowTime ) {
                        console.log("ESTA VA:",recipe._id,stage);

                        stage.alertDone = true;

                        recipe.save();

                        notifications.notifyChangeFermentationStage(
                            recipe.owner,
                            recipe._id,
                            recipe.NAME,
                            previousStage,
                            stage);
                    }

                    if ( stage.durationMode && stage.duration ) {
                        if ( stage.durationMode == 'Horas' ) {
                            timeFromEstimate += stage.duration * 1000*60*60;
                        }  else {
                            timeFromEstimate += stage.duration * 1000*60*60*24;
                        }
                    }

                    previousStage = stage;
                }
            }
        }
    });
}
