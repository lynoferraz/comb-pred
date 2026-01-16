# %%
# Load the Asia model from pgmpy
from pgmpy.utils import get_example_model
from IPython.display import Image
import pprint
import networkx as nx
from pgmpy.inference import BeliefPropagation
# from pgmpy.inference import BeliefPropagationWithMessagePassing as BeliefPropagation
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.models import FactorGraph
from pgmpy.models import JunctionTree


asia_model = get_example_model('asia')

# %%
# Visualize the network
viz = asia_model.to_graphviz()
viz.draw('asia.png', prog='neato')
Image('asia.png')

# %%
# Access attributes of the model
nodes = asia_model.nodes()
edges = asia_model.edges()
cpds = asia_model.get_cpds()

print(f"Nodes in the model: {nodes} \n")
print(f"Edges in the model: {edges} \n")
print(f"CPDs in the model: ")
pprint.pp(cpds)

# %% Convert ot junction tree
original_jt = asia_model.to_junction_tree()
original_bp = BeliefPropagation(original_jt)

pgv_agraph = nx.nx_agraph.to_agraph(original_jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jto_graph.png')
Image('jto_graph.png')

# # %% Print junction tree factors
# print(original_jt.factors[2])

# %% belief propagation
print("Query original jt lung given xray=yes")
print(original_bp.query(variables=["lung"], evidence={"xray": "yes"},))


# %% Perform inference


# %% Manual chest inference
cliques = [ # already moralized and triangulated
    ("asia","tub"),
    ("tub","lung","either"),
    ("lung","either","bronc"),
    ("bronc","lung","smoke"),
    ("either","dysp","bronc"),
    ("either","xray"),
]
edges_indexes = [ # indexes of clique
    (0,1),
    (1,2),
    (2,3),
    (2,4),
    (4,5),
]
edges = []
for edge in edges_indexes:
    edges.append((cliques[edge[0]], cliques[edge[1]]))

jt = JunctionTree()
jt.add_edges_from(edges)

for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1 for _ in range(2**len(clique))])
    jt.add_factors(phi)

bp = BeliefPropagation(jt)

print("Query lung given xray=1")
print(bp.query(variables=["lung"], evidence={"xray": 1},))

pgv_agraph = nx.nx_agraph.to_agraph(jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jt_graph.png')
Image('jt_graph.png')

# %% Aux functions
def factor_with_vars(vars,j):
    for f in j.factors:
        if len(set(vars).intersection(set(f.variables))) == len(vars):
            return f
    return None

# %% Perform edit (buy assets)


# User simple model with full jt
user_jt = JunctionTree()
jt.add_edges_from(edges)

for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1 for _ in range(2**len(clique))])
    jt.add_factors(phi)

# %% Perform edit (general jt)
# set P(either=1|lung=1) = ~1
report = {"variables":{"either":1}, "evidence":{"lung": 1}, "value":0.9}

if report["value"] < 0 or report["value"] > 1:
    raise Exception("Value must be between 0 and 1")

evidence_vars = set(report["variables"])
vars_in_report = evidence_vars.union(set(report["evidence"]))

if len(set(report["variables"]).intersection(set(report["evidence"]))) > 0:
    raise Exception("Cannot set value for variable in evidence")

jt_e = jt.copy()
factor = factor_with_vars(vars_in_report,jt_e)

if factor is None:
    raise Exception("No factor found with all variables in report")

# marginalize all variables except the ones in report
vars_not_in_report = {var for var in factor.variables if var not in vars_in_report}
wf = factor.normalize(inplace=False).marginalize(vars_not_in_report,inplace=False)

target_state = {}
other_var_states = []
for var in report["variables"]:
    if report["variables"][var] not in wf.state_names[var]:
        raise Exception(f"Variable {var} does not have state {report['variables'][var]} in factor")
    target_state[var] = report["variables"][var]
    if len(other_var_states) == 0:
        other_var_states = [{var:s} for s in wf.state_names[var] if s != report["variables"][var]]
    else:
        new_ovss = []
        for ovs in other_var_states:
            for s in wf.state_names[var]:
                if s != report["variables"][var]:
                    ovs_copy = ovs.copy()
                    ovs_copy[var] = s
                    new_ovss.append(ovs_copy)
        other_var_states = new_ovss

other_states = []
other_var_states_with_evidence = []
for e in report["evidence"]:
    if report["evidence"][e] not in wf.state_names[e]:
        raise Exception(f"Variable {e} does not have state {report['evidence'][e]} in factor")
    target_state[e] = report["evidence"][e]
    for ovs in other_var_states:
        ovs_copy = ovs.copy()
        ovs_copy[e] = report["evidence"][e]
        other_var_states_with_evidence.append(ovs_copy)
    for s in wf.state_names[e]:
        if s != report["evidence"][e]:
            if len(other_states) == 0:
                for v in report["variables"]:
                    for sv in wf.state_names[v]:
                        other_states.append({e:s, v:sv})
            else:
                new_osss = []
                for oss in other_states:
                    for s in wf.state_names[e]:
                        if s != report["evidence"][e]:
                            os_copy = oss.copy()
                            os_copy[e] = s
                            new_osss.append(os_copy)
                other_states = new_osss

# get full target states
full_target_states = []
full_other_var_states_with_evidence = []
full_other_states = []
for ov in vars_not_in_report:
    for s in factor.state_names[ov]:
        t = target_state.copy()
        t[ov] = s
        full_target_states.append(t)
        for oe in other_var_states_with_evidence:
            foe = oe.copy()
            foe[ov] = s
            full_other_var_states_with_evidence.append(foe)
        new_other_states = []
        for oss in other_states:
            fos = oss.copy()
            fos[ov] = s
            full_other_states.append(fos)

probs_considering_evidence = bp.query(variables=report['variables'].keys(),evidence=report['evidence'])

p_target = probs_considering_evidence.get_value(**report['variables'])
x_target = report["value"]

possible_m = [p_target/x_target]
for o in other_var_states:
    po = probs_considering_evidence.get_value(**o)
    possible_m.append((1 - p_target)/(1 - x_target) * (1 - p_target)/po)
    # possible_m.append((1 - p_target)/(1 - x_target) * wf.get_value(**o))
    # possible_m.append(wf.get_value(**o)/(1 - x_target))

m = max(possible_m)

# # for testing
# jt_e = jt.copy()
# factor = factor_with_vars(vars_in_report,jt_e)

print("factor before edit:")
print(factor)

print(f"m value {m}")
for s in full_target_states:
    value = factor.get_value(**s)
    modifier = m * x_target / p_target
    # modifier = x_target / p_target
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

for s in full_other_var_states_with_evidence:
    value = factor.get_value(**s)
    kr = {k: v for k, v in s.items() if k in evidence_vars}
    po = probs_considering_evidence.get_value(**kr)
    modifier = m * (1-x_target) / (1-p_target) * (po) / (1-p_target)
    # modifier = ((1-x_target) / (1-p_target)) * ((po) / (1-p_target))
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

for s in full_other_states:
    value = factor.get_value(**s)
    modifier = m
    # modifier = 1
    print(f"modifier for state {s} value {modifier}")
    new_value = value * modifier
    factor.set_value(new_value, **s)

print("factor after edit:")
print(factor)

bp_e = BeliefPropagation(jt_e)
print(bp_e.query(variables=["either"], evidence={"lung": 1},))
