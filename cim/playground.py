# %%
# Load the Asia model from pgmpy
from pgmpy.utils import get_example_model
asia_model = get_example_model('asia')

# %%
# Visualize the network
from IPython.display import Image
viz = asia_model.to_graphviz()
viz.draw('asia.png', prog='neato')
Image('asia.png')

# %%
# Access attributes of the model
import pprint
nodes = asia_model.nodes()
edges = asia_model.edges()
cpds = asia_model.get_cpds()

print(f"Nodes in the model: {nodes} \n")
print(f"Edges in the model: {edges} \n")
print(f"CPDs in the model: ")
pprint.pp(cpds)

# %% Convert ot junction tree
asia_model

# %% Perform inference
from pgmpy.inference import BeliefPropagation

bp = BeliefPropagation(asia_model)
